import { authFetch, API_BASE } from './client'
import type { ProjectRecord } from './projects'

export interface UserRecord {
  id: string
  email: string
  role: 'ADMIN' | 'USER'
  createdAt: string
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export async function listUsers(): Promise<UserRecord[]> {
  const res = await authFetch(`${API_BASE}/users`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createUser(payload: { email: string; password: string; role?: UserRecord['role'] }): Promise<UserRecord> {
  const res = await authFetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<UserRecord>(res)
}

export async function updateUser(
  id: string,
  payload: Partial<{ role: UserRecord['role']; password: string }>,
): Promise<UserRecord> {
  const res = await authFetch(`${API_BASE}/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<UserRecord>(res)
}

export async function deleteUser(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/users/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

export async function listUserProjects(userId: string): Promise<ProjectRecord[]> {
  const res = await authFetch(`${API_BASE}/projects/owner/${userId}`)
  return handleResponse<ProjectRecord[]>(res)
}

export async function createUserProject(
  userId: string,
  payload: { name?: string; scene?: ProjectRecord['scene'] },
): Promise<ProjectRecord> {
  const res = await authFetch(`${API_BASE}/users/${userId}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<ProjectRecord>(res)
}

export async function updateUserProject(
  userId: string,
  projectId: string,
  payload: Partial<{ name: string; scene: ProjectRecord['scene'] }>,
): Promise<ProjectRecord> {
  const res = await authFetch(`${API_BASE}/users/${userId}/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<ProjectRecord>(res)
}

export async function deleteUserProject(userId: string, projectId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/users/${userId}/projects/${projectId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}
