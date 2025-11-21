export const API_BASE = '/api'
const AUTH_TOKEN_KEY = 'scrapbook:authToken'

export const authStorage = {
  read(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(AUTH_TOKEN_KEY)
  },
  write(token: string | null) {
    if (typeof window === 'undefined') return
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token)
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
    }
  },
}

export const getAuthHeaders = () => {
  const token = authStorage.read()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const clearLocalAuth = () => {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(AUTH_TOKEN_KEY)
  window.localStorage.removeItem('scrapbook:lastProjectId')
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {})
  const authHeaders = getAuthHeaders()
  Object.entries(authHeaders).forEach(([key, value]) => headers.set(key, value))
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401) {
    clearLocalAuth()
    if (typeof window !== 'undefined') {
      window.location.assign('/login')
    }
    throw new Error('Unauthorized')
  }
  return response
}
