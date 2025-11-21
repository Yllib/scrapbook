import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../state/auth'
import { useAuthBootstrap } from '../hooks/useAuthBootstrap'

interface Props {
  children: ReactNode
}

export function RequireAuth({ children }: Props) {
  const location = useLocation()
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  useAuthBootstrap()

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  if (loading || !user) {
    return <div className="auth-shell"><div className="auth-card">Checking session…</div></div>
  }

  return <>{children}</>
}
