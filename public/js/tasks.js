const statusLabels = {
  pending: 'В ожидании',
  in_progress: 'В процессе',
  done: 'Завершено'
};

function escapeHtml(s) {
  if (!s) return '';
  return s.replaceAll('&','&amp;')
          .replaceAll('<','&lt;')
          .replaceAll('>','&gt;')
          .replaceAll('"','&quot;');
}

const TaskManager = {
  tasksElement: null,
  createForm: null,
  filterElement: null,
  initialized: false,

  init() {
    if (this.initialized) return;
    this.tasksElement = document.getElementById('tasks');
    this.createForm = document.getElementById('createForm');
    this.filterElement = document.getElementById('filter');
    this.bindEvents();
    this.fetchTasks();
    this.initialized = true;
  },

  bindEvents() {
    this.createForm.addEventListener('submit', this.handleCreateTask.bind(this));
    this.filterElement.addEventListener('change', this.fetchTasks.bind(this));
  },

  async fetchTasks() {
    const status = this.filterElement.value;
    const vars = status ? { status } : {};
    try {
      this.showLoading();
      const data = await authFetchGraphQL(`
        query($status: String) {
          tasks(status: $status) {
            id
            title
            description
            status
            due_date
          }
        }
      `, vars);
      this.renderTasks(data.tasks);
    } catch (err) {
      this.showError('Ошибка загрузки задач: ' + err.message);
    }
  },

  renderTasks(tasks) {
    this.tasksElement.innerHTML = '';
    if (!tasks.length) {
      this.tasksElement.innerHTML = '<p class="loading">Нет задач</p>';
      return;
    }
    for (const task of tasks) {
      const el = document.createElement('div');
      el.className = `task ${task.status}`;
      el.innerHTML = `
        <h3>${escapeHtml(task.title)}</h3>
        <p>${escapeHtml(task.description || '')}</p>
        <p><strong>Статус:</strong> ${statusLabels[task.status] || task.status}</p>
        <p><strong>Срок:</strong> ${task.due_date || '-'}</p>
        <div class="actions">
          <button data-del="${task.id}">Удалить</button>
        </div>
      `;
      el.querySelector('[data-del]').addEventListener('click', () => this.deleteTask(task.id));
      this.tasksElement.appendChild(el);
    }
  },

  async handleCreateTask(ev) {
    ev.preventDefault();
    const fd = new FormData(this.createForm);
    const vars = {
      title: fd.get('title'),
      description: fd.get('description'),
      status: fd.get('status'),
      due_date: fd.get('due_date')
    };

    try {
      await authFetchGraphQL(`
        mutation($title: String!, $description: String, $status: String, $due_date: String) {
          createTask(title: $title, description: $description, status: $status, due_date: $due_date) {
            id
          }
        }
      `, vars);

      this.createForm.reset();
      this.fetchTasks();
    } catch (err) {
      this.showError('Ошибка при создании: ' + err.message);
    }
  },

  async deleteTask(id) {
    if (!confirm('Удалить задачу?')) return;
    try {
      await authFetchGraphQL(`
        mutation($id: ID!) {
          deleteTask(id: $id)
        }
      `, { id });
      this.fetchTasks();
    } catch (err) {
      this.showError('Ошибка удаления: ' + err.message);
    }
  },

  showLoading() {
    this.tasksElement.innerHTML = '<p class="loading">Загрузка...</p>';
  },

  showError(msg) {
    alert(msg);
  }
};
