import type { SceneDocument } from '../state/scene'
import { authFetch, API_BASE } from './client'

export interface ProjectRecord {
  id: string
  name: string
  scene: SceneDocument | null
  createdAt: string
  updatedAt: string
}

export interface SharedProjectRecord {
  project: {
    id: string
    name: string
    scene: SceneDocument | null
    updatedAt: string
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export async function createProject(payload: { name?: string; scene: SceneDocument }): Promise<ProjectRecord> {
  const response = await authFetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<ProjectRecord>(response)
}

export async function fetchProject(projectId: string): Promise<ProjectRecord> {
  const response = await authFetch(`${API_BASE}/projects/${projectId}`)
  return handleResponse<ProjectRecord>(response)
}

export async function updateProject(
  projectId: string,
  payload: { name?: string; scene?: SceneDocument },
): Promise<ProjectRecord> {
  const response = await authFetch(`${API_BASE}/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return handleResponse<ProjectRecord>(response)
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const response = await authFetch(`${API_BASE}/projects`)
  return handleResponse<ProjectRecord[]>(response)
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/projects/${projectId}`, { method: 'DELETE' })
  if (!response.ok) {
    const msg = await response.text()
    throw new Error(msg || 'Failed to delete project')
  }
}

export async function getShareLink(projectId: string): Promise<string | null> {
  const response = await authFetch(`${API_BASE}/projects/${projectId}/share`)
  const data = await handleResponse<{ token: string | null }>(response)
  return data.token ?? null
}

export async function createShareLink(projectId: string): Promise<string> {
  const response = await authFetch(`${API_BASE}/projects/${projectId}/share`, { method: 'POST' })
  const data = await handleResponse<{ token: string }>(response)
  return data.token
}

export async function revokeShareLink(projectId: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/projects/${projectId}/share`, { method: 'DELETE' })
  if (!response.ok) {
    const msg = await response.text()
    throw new Error(msg || 'Failed to revoke link')
  }
}

export async function fetchSharedProject(token: string): Promise<SharedProjectRecord> {
  const response = await fetch(`${API_BASE}/share/${token}`)
  return handleResponse<SharedProjectRecord>(response)
}
