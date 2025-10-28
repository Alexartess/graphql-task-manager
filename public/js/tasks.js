const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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

//менеджер задач
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
            files {
              id
              name
              url
            }
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
      const div = document.createElement('div');
      div.className = `task ${task.status}`;
      div.innerHTML = `
        <h3>${escapeHtml(task.title)}</h3>
        <p>${escapeHtml(task.description || '')}</p>
        <p><strong>Статус:</strong> ${statusLabels[task.status] || task.status}</p>
        <p><strong>Срок:</strong> ${task.due_date || '-'}</p>
        ${task.files && task.files.length ? 
          '<p><strong>Файлы:</strong> ' + 
          task.files.map(f => `<a href="${f.url}" target="_blank">${escapeHtml(f.name)}</a>`).join(', ') + 
          '</p>' : ''}
        <div class="actions">
          <button class="delete" data-del="${task.id}">Удалить</button>
          <button class="edit" data-edit="${task.id}">Изменить</button>
        </div>
      `;
      div.querySelector('[data-del]').addEventListener('click', () => this.deleteTask(task.id));
      div.querySelector('[data-edit]').addEventListener('click', () => this.showEditForm(task.id));
      this.tasksElement.appendChild(div);
    }
  },

  async handleCreateTask(ev) {
    ev.preventDefault();
    const fd = new FormData(this.createForm);

    const files = fd.getAll('files').filter(f => f && f.name);
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        this.showError(`Файл "${file.name}" превышает 5 MB`);
        return;
      }
    }

    const vars = {
      title: fd.get('title'),
      description: fd.get('description'),
      status: fd.get('status'),
      due_date: fd.get('due_date')
    };

    try {
      const data = await authFetchGraphQL(`
        mutation($title: String!, $description: String, $status: String, $due_date: String) {
          createTask(title: $title, description: $description, status: $status, due_date: $due_date) {
            id
          }
        }
      `, vars);

      const taskId = data.createTask.id;

      // если есть файлы, загружаем их через отдельный REST 
      if (files.length) {
        const uploadFd = new FormData();
        for (const f of files) uploadFd.append('files', f);
        await authFetchRest(`/files/upload/${taskId}`, { method: 'POST', body: uploadFd });
      }

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
        mutation($id: ID!) { deleteTask(id: $id) }
      `, { id });
      this.fetchTasks();
    } catch (err) {
      this.showError('Ошибка удаления: ' + err.message);
    }
  },

  async showEditForm(id) {
    try {
      const data = await authFetchGraphQL(`
        query($id: ID!) {
          task(id: $id) {
            id
            title
            description
            status
            due_date
            files { id name url }
          }
        }
      `, { id });

      this.renderEditForm(data.task);
    } catch (err) {
      this.showError('Ошибка загрузки задачи: ' + err.message);
    }
  },

  renderEditForm(task) {
    const filesHtml = (task.files && task.files.length)
      ? `<ul class="file-list">` + task.files.map(f =>
          `<li>${escapeHtml(f.name)} <button type="button" data-file-id="${f.id}" data-task-id="${task.id}">Удалить</button></li>`
        ).join('') + `</ul>`
      : '<p>Файлов нет</p>';

    const div = document.createElement('div');
    div.className = `task edit-form ${task.status}`;
    div.innerHTML = `
      <h3>Редактировать задачу</h3>
      <input type="text" id="edit-title-${task.id}" value="${escapeHtml(task.title)}" />
      <textarea id="edit-desc-${task.id}">${escapeHtml(task.description || '')}</textarea>
      <select id="edit-status-${task.id}">
        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>В ожидании</option>
        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>В процессе</option>
        <option value="done" ${task.status === 'done' ? 'selected' : ''}>Завершено</option>
      </select>
      <input type="date" id="edit-due-${task.id}" value="${task.due_date || ''}" />
      <h4>Файлы</h4>
      ${filesHtml}
      <input type="file" id="edit-files-${task.id}" multiple />
      <div class="actions">
        <button class="edit" data-save="${task.id}" type="button">Сохранить</button>
        <button class="delete" data-cancel type="button">Отмена</button>
      </div>
    `;

    div.querySelector('[data-save]').addEventListener('click', () => this.saveTask(task.id));
    div.querySelector('[data-cancel]').addEventListener('click', () => this.fetchTasks());
    div.querySelectorAll('[data-file-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        const fileId = e.target.getAttribute('data-file-id');
        const taskId = e.target.getAttribute('data-task-id');
        this.deleteFile(taskId, fileId);
      });
    });

    const existing = [...this.tasksElement.children].find(ch => ch.querySelector(`[data-edit="${task.id}"]`));
    if (existing) this.tasksElement.replaceChild(div, existing);
    else this.tasksElement.prepend(div);
  },

  async deleteFile(taskId, fileId) {
    if (!confirm('Удалить файл?')) return;
    try {
      await authFetchRest(`/files/${fileId}`, { method: 'DELETE' });
      this.showEditForm(taskId);
    } catch (err) {
      this.showError('Ошибка при удалении файла: ' + err.message);
    }
  },

  async saveTask(id) {
    const newTitle = document.getElementById(`edit-title-${id}`).value.trim();
    const newDesc = document.getElementById(`edit-desc-${id}`).value;
    const newStatus = document.getElementById(`edit-status-${id}`).value;
    const newDue = document.getElementById(`edit-due-${id}`).value;
    const newFiles = document.getElementById(`edit-files-${id}`).files;

    try {
      await authFetchGraphQL(`
        mutation($id: ID!, $title: String!, $description: String, $status: String, $due_date: String) {
          updateTask(id: $id, title: $title, description: $description, status: $status, due_date: $due_date) {
            id
          }
        }
      `, { id, title: newTitle, description: newDesc, status: newStatus, due_date: newDue });

      if (newFiles.length) {
        const fd = new FormData();
        for (const file of newFiles) {
          if (file.size > MAX_FILE_SIZE) {
            this.showError(`Файл "${file.name}" превышает 5 MB`);
            return;
          }
          fd.append('files', file);
        }
        await authFetchRest(`/files/upload/${id}`, { method: 'POST', body: fd });
      }

      this.fetchTasks();
    } catch (err) {
      this.showError('Ошибка при сохранении задачи: ' + err.message);
    }
  },

  showLoading() {
    this.tasksElement.innerHTML = '<p class="loading">Загрузка...</p>';
  },

  showError(msg) {
    alert(msg);
  }
};
