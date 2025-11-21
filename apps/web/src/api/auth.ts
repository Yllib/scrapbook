import { authFetch, API_BASE } from './client'
import type { AuthUser } from '../state/auth'

export interface AuthResponse {
  token: string
  user: AuthUser
}

export async function signup(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json()
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json()
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await authFetch(`${API_BASE}/auth/me`)
  if (response.status === 401) {
    throw new Error('Unauthorized')
  }
  if (!response.ok) {
    throw new Error(await response.text())
  }
  return response.json()
}

export async function logout() {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' })
}
