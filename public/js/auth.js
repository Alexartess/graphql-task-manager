async function authFetchGraphQL(query, variables = {}) {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json();

  // обработка неавторизованных запросов
  if (json.errors && json.errors[0]?.message === 'UNAUTHENTICATED') {
    AuthManager.setCurrentUser(null);
    AuthManager.showAuth();
    throw new Error('Authentication required');
  }

  if (json.errors) {
    throw new Error(json.errors[0].message || 'GraphQL error');
  }

  return json.data;
}


async function authFetchRest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include'
  });
  
  if (res.status === 401) {
    AuthManager.setCurrentUser(null);
    AuthManager.showAuth();
    throw new Error('Authentication required');
  }
  
  return res;
}


// менеджер аутентификации
const AuthManager = {
  currentUser: null,

  init() {
    this.bindEvents();
    this.checkAuth();
  },

  bindEvents() {
    document.getElementById('loginForm').addEventListener('submit', this.handleLogin.bind(this));
    document.getElementById('registerForm').addEventListener('submit', this.handleRegister.bind(this));
    document.getElementById('logoutButton').addEventListener('click', this.handleLogout.bind(this));
    document.getElementById('showRegisterLink').addEventListener('click', this.showRegister.bind(this));
    document.getElementById('showLoginLink').addEventListener('click', this.showLogin.bind(this));
  },

  async checkAuth() {
    try {
      const data = await authFetchGraphQL(`
        query {
          me {
            id
            username
          }
        }
      `);
      if (data.me) {
        this.setCurrentUser(data.me);
        this.showApp();
      } else {
        this.showAuth();
      }
    } catch {
      this.showAuth();
    }
  },

  showAuth() {
    document.getElementById('authSection').classList.remove('hidden');
    document.getElementById('appSection').classList.add('hidden');
  },

  showApp() {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('appSection').classList.remove('hidden');
    document.getElementById('username').textContent = this.currentUser.username;
    if (typeof TaskManager !== 'undefined') {
      TaskManager.init();
    }
  },

  showRegister() {
    document.getElementById('loginForm').parentElement.classList.add('hidden');
    document.getElementById('registerSection').classList.remove('hidden');
  },

  showLogin() {
    document.getElementById('registerSection').classList.add('hidden');
    document.getElementById('loginForm').parentElement.classList.remove('hidden');
  },

  async handleLogin(ev) {
    ev.preventDefault();
    const formData = new FormData(ev.target);
    const vars = {
      username: formData.get('username'),
      password: formData.get('password')
    };

    try {
      const data = await authFetchGraphQL(`
        mutation($username: String!, $password: String!) {
          login(username: $username, password: $password) {
            id
            username
          }
        }
      `, vars);

      this.setCurrentUser(data.login);
      this.showApp();
    } catch (err) {
      this.showError('Ошибка входа: ' + err.message);
    }
  },

  async handleRegister(ev) {
    ev.preventDefault();
    const formData = new FormData(ev.target);
    const vars = {
      username: formData.get('username'),
      password: formData.get('password')
    };

    try {
      const data = await authFetchGraphQL(`
        mutation($username: String!, $password: String!) {
          register(username: $username, password: $password) {
            id
            username
          }
        }
      `, vars);

      this.setCurrentUser(data.register);
      this.showApp();
    } catch (err) {
      this.showError('Ошибка регистрации: ' + err.message);
    }
  },

  async handleLogout() {
    try {
      await authFetchGraphQL(`
        mutation {
          logout
        }
      `);
      this.setCurrentUser(null);
      this.showAuth();
    } catch (err) {
      console.error('Logout error:', err);
    }
  },

  setCurrentUser(user) {
    this.currentUser = user;
  },

  getCurrentUser() {
    return this.currentUser;
  },

  showError(message) {
    alert(message);
  }
};
