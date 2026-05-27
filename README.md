# TaskFlow

A full-stack task management web application for creating, updating, deleting, and tracking tasks.

## Features

- User registration, login, logout, and protected API routes
- Password hashing with Node.js `crypto.pbkdf2`
- CRUD operations for authenticated users' tasks
- Task status, priority, due dates, search, and filtering
- Real-time task refresh across open tabs using Server-Sent Events
- Responsive layout for desktop and mobile screens
- File-backed local persistence in `data/db.json`

## Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `GET /api/tasks/stream`
