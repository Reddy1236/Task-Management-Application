const state = {
  token: localStorage.getItem('taskflow-token') || '',
  user: null,
  tasks: [],
  authMode: 'login',
  stream: null
}

const els = {
  authPanel: document.querySelector('#authPanel'),
  appPanel: document.querySelector('#appPanel'),
  loginTab: document.querySelector('#loginTab'),
  registerTab: document.querySelector('#registerTab'),
  authForm: document.querySelector('#authForm'),
  authSubmit: document.querySelector('#authSubmit'),
  authMessage: document.querySelector('#authMessage'),
  nameInput: document.querySelector('#nameInput'),
  emailInput: document.querySelector('#emailInput'),
  passwordInput: document.querySelector('#passwordInput'),
  registerOnly: document.querySelectorAll('.register-only'),
  logoutBtn: document.querySelector('#logoutBtn'),
  welcomeTitle: document.querySelector('#welcomeTitle'),
  taskForm: document.querySelector('#taskForm'),
  taskId: document.querySelector('#taskId'),
  taskTitle: document.querySelector('#taskTitle'),
  taskDescription: document.querySelector('#taskDescription'),
  taskStatus: document.querySelector('#taskStatus'),
  taskPriority: document.querySelector('#taskPriority'),
  taskDueDate: document.querySelector('#taskDueDate'),
  editorTitle: document.querySelector('#editorTitle'),
  taskSubmit: document.querySelector('#taskSubmit'),
  cancelEditBtn: document.querySelector('#cancelEditBtn'),
  taskMessage: document.querySelector('#taskMessage'),
  taskList: document.querySelector('#taskList'),
  emptyState: document.querySelector('#emptyState'),
  searchInput: document.querySelector('#searchInput'),
  filterStatus: document.querySelector('#filterStatus'),
  totalCount: document.querySelector('#totalCount'),
  todoCount: document.querySelector('#todoCount'),
  progressCount: document.querySelector('#progressCount'),
  doneCount: document.querySelector('#doneCount')
}

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`

  const response = await fetch(path, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Something went wrong.')
  return data
}

function setAuthMode(mode) {
  state.authMode = mode
  els.loginTab.classList.toggle('is-active', mode === 'login')
  els.registerTab.classList.toggle('is-active', mode === 'register')
  els.registerOnly.forEach((el) => el.classList.toggle('is-hidden', mode !== 'register'))
  els.authSubmit.textContent = mode === 'login' ? 'Login' : 'Create Account'
  els.passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password'
  els.authMessage.textContent = ''
}

function showApp() {
  els.authPanel.classList.add('is-hidden')
  els.appPanel.classList.remove('is-hidden')
  els.welcomeTitle.textContent = `${state.user.name}'s Tasks`
}

function showAuth() {
  els.appPanel.classList.add('is-hidden')
  els.authPanel.classList.remove('is-hidden')
  stopStream()
}

function resetTaskForm() {
  els.taskForm.reset()
  els.taskId.value = ''
  els.taskStatus.value = 'todo'
  els.taskPriority.value = 'medium'
  els.editorTitle.textContent = 'Create Task'
  els.taskSubmit.textContent = 'Create Task'
  els.cancelEditBtn.classList.add('is-hidden')
}

function formatLabel(value) {
  return value.replace('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDate(value) {
  if (!value) return 'No due date'
  const date = new Date(`${value}T00:00:00`)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function filteredTasks() {
  const query = els.searchInput.value.trim().toLowerCase()
  const status = els.filterStatus.value

  return state.tasks.filter((task) => {
    const matchesStatus = status === 'all' || task.status === status
    const haystack = `${task.title} ${task.description} ${task.priority}`.toLowerCase()
    return matchesStatus && haystack.includes(query)
  })
}

function renderStats() {
  els.totalCount.textContent = state.tasks.length
  els.todoCount.textContent = state.tasks.filter((task) => task.status === 'todo').length
  els.progressCount.textContent = state.tasks.filter((task) => task.status === 'in-progress').length
  els.doneCount.textContent = state.tasks.filter((task) => task.status === 'done').length
}

function renderTasks() {
  renderStats()
  const tasks = filteredTasks()
  els.taskList.innerHTML = ''
  els.emptyState.classList.toggle('is-hidden', tasks.length > 0)

  for (const task of tasks) {
    const article = document.createElement('article')
    article.className = `task-card priority-${task.priority}`
    article.innerHTML = `
      <div class="task-head">
        <div>
          <h3 class="task-title"></h3>
          <p class="task-description"></p>
        </div>
        <div class="card-actions">
          <button class="icon-btn" type="button" data-action="edit" title="Edit task" aria-label="Edit task">✎</button>
          <button class="icon-btn delete" type="button" data-action="delete" title="Delete task" aria-label="Delete task">×</button>
        </div>
      </div>
      <div class="pill-row">
        <span class="pill status-${task.status}">${formatLabel(task.status)}</span>
        <span class="pill">${formatLabel(task.priority)} priority</span>
        <span class="pill">${formatDate(task.dueDate)}</span>
      </div>
    `
    article.querySelector('.task-title').textContent = task.title
    article.querySelector('.task-description').textContent = task.description || 'No description added.'
    article.querySelector('[data-action="edit"]').addEventListener('click', () => editTask(task))
    article.querySelector('[data-action="delete"]').addEventListener('click', () => deleteTask(task.id))
    els.taskList.append(article)
  }
}

async function loadTasks() {
  const data = await api('/api/tasks')
  state.tasks = data.tasks
  renderTasks()
}

function startStream() {
  stopStream()
  if (!state.token || !window.EventSource) return
  state.stream = new EventSource(`/api/tasks/stream?token=${encodeURIComponent(state.token)}`)
  state.stream.addEventListener('tasks-changed', () => loadTasks().catch(console.error))
}

function stopStream() {
  if (state.stream) state.stream.close()
  state.stream = null
}

function editTask(task) {
  els.taskId.value = task.id
  els.taskTitle.value = task.title
  els.taskDescription.value = task.description
  els.taskStatus.value = task.status
  els.taskPriority.value = task.priority
  els.taskDueDate.value = task.dueDate
  els.editorTitle.textContent = 'Update Task'
  els.taskSubmit.textContent = 'Save Changes'
  els.cancelEditBtn.classList.remove('is-hidden')
  els.taskTitle.focus()
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return
  await api(`/api/tasks/${id}`, { method: 'DELETE' })
  state.tasks = state.tasks.filter((task) => task.id !== id)
  renderTasks()
}

els.loginTab.addEventListener('click', () => setAuthMode('login'))
els.registerTab.addEventListener('click', () => setAuthMode('register'))

els.authForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  els.authMessage.textContent = ''

  const payload = {
    email: els.emailInput.value,
    password: els.passwordInput.value
  }
  if (state.authMode === 'register') payload.name = els.nameInput.value

  try {
    const data = await api(`/api/auth/${state.authMode === 'login' ? 'login' : 'register'}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    state.token = data.token
    state.user = data.user
    localStorage.setItem('taskflow-token', state.token)
    showApp()
    await loadTasks()
    startStream()
  } catch (error) {
    els.authMessage.textContent = error.message
  }
})

els.logoutBtn.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
  state.token = ''
  state.user = null
  state.tasks = []
  localStorage.removeItem('taskflow-token')
  showAuth()
})

els.taskForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  els.taskMessage.textContent = ''

  const payload = {
    title: els.taskTitle.value,
    description: els.taskDescription.value,
    status: els.taskStatus.value,
    priority: els.taskPriority.value,
    dueDate: els.taskDueDate.value
  }

  try {
    const id = els.taskId.value
    const data = await api(id ? `/api/tasks/${id}` : '/api/tasks', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    })

    const index = state.tasks.findIndex((task) => task.id === data.task.id)
    if (index >= 0) state.tasks[index] = data.task
    else state.tasks.unshift(data.task)

    resetTaskForm()
    renderTasks()
    els.taskMessage.textContent = id ? 'Task updated.' : 'Task created.'
  } catch (error) {
    els.taskMessage.textContent = error.message
  }
})

els.cancelEditBtn.addEventListener('click', resetTaskForm)
els.searchInput.addEventListener('input', renderTasks)
els.filterStatus.addEventListener('change', renderTasks)

async function boot() {
  setAuthMode('login')
  resetTaskForm()

  if (!state.token) {
    showAuth()
    return
  }

  try {
    const data = await api('/api/auth/me')
    state.user = data.user
    showApp()
    await loadTasks()
    startStream()
  } catch {
    localStorage.removeItem('taskflow-token')
    state.token = ''
    showAuth()
  }
}

boot()
