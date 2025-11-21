import { create } from 'zustand'
import { authStorage } from '../api/client'

export interface AuthUser {
  id: string
  email: string
  role: 'ADMIN' | 'USER'
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
  setToken: (token: string | null) => void
  setUser: (user: AuthUser | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

const initialToken = authStorage.read()

export const useAuthStore = create<AuthState>((set) => ({
  token: initialToken,
  user: null,
  loading: false,
  setToken: (token) => {
    authStorage.write(token)
    set({ token })
  },
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  reset: () => {
    authStorage.write(null)
    set({ token: null, user: null })
  },
}))
