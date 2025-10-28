const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { ApolloServer, gql } = require('apollo-server-express');

const JWT_SECRET = process.env.JWT_SECRET || 'dltvluHBdhajyETI47-IByyrt7';
const JWT_EXPIRES_IN = '7d';
const SALT_ROUNDS = 12;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random()*1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const DB_PATH = path.join(__dirname, 'db.sqlite');
const db = new sqlite3.Database(DB_PATH);

//инициализация базы данных
function runAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function allAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function getAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    due_date TEXT,
    created_at TEXT NOT NULL,
    user_id INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT,
    mime TEXT,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
});

// Middleware аутентификации
const getUserFromToken = (req) => {
  const token = req.cookies?.token;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

//graphQL schema
const typeDefs = gql`
  type User {
    id: ID!
    username: String!
  }

  type File {
    id: ID!
    url: String!
    name: String
    mime: String
  }

  type Task {
    id: ID!
    title: String!
    description: String
    status: String
    due_date: String
    created_at: String
    files: [File]
  }

  type Query {
    me: User
    tasks(status: String): [Task]
    task(id: ID!): Task
  }

  type Mutation {
    register(username: String!, password: String!): User
    login(username: String!, password: String!): User
    logout: Boolean

    createTask(title: String!, description: String, status: String, due_date: String): Task
    updateTask(id: ID!, title: String, description: String, status: String, due_date: String): Task
    deleteTask(id: ID!): Boolean
    deleteFile(id: ID!): Boolean
  }
`;

// resolvers
const resolvers = {
  Query: {
    me: async (_, __, { user }) => user || null,

    tasks: async (_, { status }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      const sql = status
        ? 'SELECT * FROM tasks WHERE status = ? AND user_id = ? ORDER BY due_date IS NULL, due_date ASC'
        : 'SELECT * FROM tasks WHERE user_id = ? ORDER BY due_date IS NULL, due_date ASC';
      const params = status ? [status, user.id] : [user.id];
      const rows = await allAsync(sql, params);

      for (const t of rows) {
        const files = await allAsync('SELECT * FROM files WHERE task_id = ?', [t.id]);
        t.files = files.map(f => ({
          id: f.id,
          url: '/uploads/' + f.filename,
          name: f.original_name,
          mime: f.mime
        }));
      }
      return rows;
    },

    task: async (_, { id }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      const t = await getAsync('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, user.id]);
      if (!t) throw new Error('Not found');
      const files = await allAsync('SELECT * FROM files WHERE task_id = ?', [id]);
      t.files = files.map(f => ({
        id: f.id,
        url: '/uploads/' + f.filename,
        name: f.original_name,
        mime: f.mime
      }));
      return t;
    }
  },

  Mutation: {
    register: async (_, { username, password }, { res }) => {
      if (!username || !password) throw new Error('Missing username or password');
      if (password.length < 6) throw new Error('Password too short');

      const existing = await getAsync('SELECT id FROM users WHERE username = ?', [username]);
      if (existing) throw new Error('User already exists');

      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const now = new Date().toISOString();
      const result = await runAsync(
        'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
        [username, hash, now]
      );

      const token = jwt.sign({ id: result.lastID, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      return { id: result.lastID, username };
    },

    login: async (_, { username, password }, { res }) => {
      const user = await getAsync('SELECT * FROM users WHERE username = ?', [username]);
      if (!user) throw new Error('Invalid credentials');
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) throw new Error('Invalid credentials');

      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      return { id: user.id, username: user.username };
    },

    logout: async (_, __, { res }) => {
      res.clearCookie('token');
      return true;
    },

    createTask: async (_, args, { user }) => {
      if (!user) throw new Error('Unauthorized');
      const now = new Date().toISOString();
      const { title, description = '', status = 'pending', due_date = null } = args;
      const result = await runAsync(
        'INSERT INTO tasks (title, description, status, due_date, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?)',
        [title, description, status, due_date, now, user.id]
      );
      return await getAsync('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
    },

    updateTask: async (_, { id, ...fields }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      const existing = await getAsync('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, user.id]);
      if (!existing) throw new Error('Not found');

      const set = [];
      const params = [];
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined) { set.push(`${key} = ?`); params.push(val); }
      }
      if (set.length) {
        params.push(id, user.id);
        await runAsync(`UPDATE tasks SET ${set.join(', ')} WHERE id = ? AND user_id = ?`, params);
      }
      return await getAsync('SELECT * FROM tasks WHERE id = ?', [id]);
    },

    deleteTask: async (_, { id }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      const exists = await getAsync('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, user.id]);
      if (!exists) throw new Error('Not found');
      const files = await allAsync('SELECT filename FROM files WHERE task_id = ?', [id]);
      for (const f of files) {
        const p = path.join(UPLOAD_DIR, f.filename);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      await runAsync('DELETE FROM files WHERE task_id = ?', [id]);
      await runAsync('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, user.id]);
      return true;
    },

    deleteFile: async (_, { id }, { user }) => {
      if (!user) throw new Error('Unauthorized');
      const f = await getAsync(`
        SELECT f.* FROM files f
        JOIN tasks t ON f.task_id = t.id
        WHERE f.id = ? AND t.user_id = ?
      `, [id, user.id]);
      if (!f) throw new Error('Not found');
      const p = path.join(UPLOAD_DIR, f.filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      await runAsync('DELETE FROM files WHERE id = ?', [id]);
      return true;
    }
  }
};


//запускаем graphql сервер
(async () => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req, res }) => {
      const user = getUserFromToken(req);
      return { req, res, user };
    }
  });
  await server.start();
  server.applyMiddleware({ app, path: '/graphql' });

  app.listen(PORT, () => {
    console.log(`GraphQL server running at http://localhost:${PORT}/graphql`);
  });
})();


app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
