import { authFetch, API_BASE } from './client'

export type CollaboratorRole = 'OWNER' | 'EDITOR' | 'VIEWER'

export interface CollaboratorRecord {
  projectId: string
  userId: string
  role: CollaboratorRole
  user: {
    id: string
    email: string
    role: 'ADMIN' | 'USER'
  }
}

export async function listCollaborators(projectId: string): Promise<CollaboratorRecord[]> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/collaborators`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function addCollaboratorByEmail(projectId: string, email: string, role: 'EDITOR' | 'VIEWER') {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/collaborators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function removeCollaborator(projectId: string, userId: string) {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/collaborators/${userId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
