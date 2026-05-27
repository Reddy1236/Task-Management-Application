const http = require('http')
const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

const PORT = Number(process.env.PORT || 3000)
const PUBLIC_DIR = path.join(__dirname, 'public')
const DATA_DIR = path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24

const sessions = new Map()
const taskStreams = new Map()

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(DB_FILE)
  } catch {
    await writeDb({ users: [], tasks: [] })
  }
}

async function readDb() {
  await ensureDb()
  const raw = await fs.readFile(DB_FILE, 'utf8')
  return JSON.parse(raw)
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2))
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message })
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':')
  if (!salt || !expected) return false
  const actual = hashPassword(password, salt).split(':')[1]
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  sessions.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL_MS })
  return token
}

function getToken(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  const url = new URL(req.url, `http://${req.headers.host}`)
  return url.searchParams.get('token')
}

async function getCurrentUser(req) {
  const token = getToken(req)
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  const db = await readDb()
  return db.users.find((user) => user.id === session.userId) || null
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        req.destroy()
        reject(new Error('Request body is too large'))
      }
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function cleanTaskInput(input, existing = {}) {
  const title = String(input.title ?? existing.title ?? '').trim()
  const description = String(input.description ?? existing.description ?? '').trim()
  const priority = ['low', 'medium', 'high'].includes(input.priority) ? input.priority : existing.priority || 'medium'
  const status = ['todo', 'in-progress', 'done'].includes(input.status) ? input.status : existing.status || 'todo'
  const dueDate = input.dueDate === '' ? '' : String(input.dueDate ?? existing.dueDate ?? '').slice(0, 10)

  return { title, description, priority, status, dueDate }
}

function broadcastTasks(userId) {
  const streams = taskStreams.get(userId)
  if (!streams) return
  for (const res of streams) {
    res.write(`event: tasks-changed\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`)
  }
}

async function handleAuth(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await parseBody(req)
    const name = String(body.name || '').trim()
    const email = normalizeEmail(body.email)
    const password = String(body.password || '')

    if (!name || !email || password.length < 6) {
      return sendError(res, 400, 'Name, valid email, and a 6+ character password are required.')
    }

    const db = await readDb()
    if (db.users.some((user) => user.email === email)) {
      return sendError(res, 409, 'An account with this email already exists.')
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    }
    db.users.push(user)
    await writeDb(db)

    const token = issueToken(user.id)
    return sendJson(res, 201, { token, user: publicUser(user) })
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody(req)
    const email = normalizeEmail(body.email)
    const password = String(body.password || '')
    const db = await readDb()
    const user = db.users.find((item) => item.email === email)

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendError(res, 401, 'Invalid email or password.')
    }

    const token = issueToken(user.id)
    return sendJson(res, 200, { token, user: publicUser(user) })
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const user = await getCurrentUser(req)
    if (!user) return sendError(res, 401, 'Authentication required.')
    return sendJson(res, 200, { user: publicUser(user) })
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = getToken(req)
    if (token) sessions.delete(token)
    return sendJson(res, 200, { ok: true })
  }

  return false
}

async function handleTasks(req, res, pathname) {
  const user = await getCurrentUser(req)
  if (!user) return sendError(res, 401, 'Authentication required.')

  if (req.method === 'GET' && pathname === '/api/tasks/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`)
    if (!taskStreams.has(user.id)) taskStreams.set(user.id, new Set())
    taskStreams.get(user.id).add(res)
    req.on('close', () => {
      const streams = taskStreams.get(user.id)
      if (!streams) return
      streams.delete(res)
      if (streams.size === 0) taskStreams.delete(user.id)
    })
    return true
  }

  const db = await readDb()
  const userTasks = () => db.tasks.filter((task) => task.userId === user.id)

  if (req.method === 'GET' && pathname === '/api/tasks') {
    return sendJson(res, 200, { tasks: userTasks().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) })
  }

  if (req.method === 'POST' && pathname === '/api/tasks') {
    const body = await parseBody(req)
    const clean = cleanTaskInput(body)
    if (!clean.title) return sendError(res, 400, 'Task title is required.')

    const now = new Date().toISOString()
    const task = {
      id: crypto.randomUUID(),
      userId: user.id,
      ...clean,
      createdAt: now,
      updatedAt: now
    }
    db.tasks.push(task)
    await writeDb(db)
    broadcastTasks(user.id)
    return sendJson(res, 201, { task })
  }

  const match = pathname.match(/^\/api\/tasks\/([a-f0-9-]+)$/)
  if (!match) return false

  const task = db.tasks.find((item) => item.id === match[1] && item.userId === user.id)
  if (!task) return sendError(res, 404, 'Task not found.')

  if (req.method === 'PUT') {
    const body = await parseBody(req)
    const clean = cleanTaskInput(body, task)
    if (!clean.title) return sendError(res, 400, 'Task title is required.')

    Object.assign(task, clean, { updatedAt: new Date().toISOString() })
    await writeDb(db)
    broadcastTasks(user.id)
    return sendJson(res, 200, { task })
  }

  if (req.method === 'DELETE') {
    db.tasks = db.tasks.filter((item) => item.id !== task.id)
    await writeDb(db)
    broadcastTasks(user.id)
    return sendJson(res, 200, { ok: true })
  }

  return false
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested))
  if (!filePath.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden')

  try {
    const data = await fs.readFile(filePath)
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    const index = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'))
    res.writeHead(200, { 'Content-Type': contentTypes['.html'] })
    res.end(index)
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname

  try {
    if (pathname.startsWith('/api/auth')) {
      const handled = await handleAuth(req, res, pathname)
      if (handled !== false) return
    }

    if (pathname.startsWith('/api/tasks')) {
      const handled = await handleTasks(req, res, pathname)
      if (handled !== false) return
    }

    if (pathname.startsWith('/api/')) return sendError(res, 404, 'Endpoint not found.')
    return serveStatic(req, res, pathname)
  } catch (error) {
    return sendError(res, error.message === 'Invalid JSON body' ? 400 : 500, error.message || 'Server error')
  }
}

ensureDb().then(() => {
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`Task management app running at http://localhost:${PORT}`)
  })
})
