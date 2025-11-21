import { useNavigate } from 'react-router-dom'
import { logout } from '../api/auth'
import { useAuthStore } from '../state/auth'

export function TopBar() {
  const navigate = useNavigate()
  const resetAuth = useAuthStore((s) => s.reset)
  const user = useAuthStore((s) => s.user)

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('logout failed', error)
    }
    resetAuth()
    localStorage.removeItem('scrapbook:lastProjectId')
    navigate('/login', { replace: true })
  }

  return (
    <div className="top-bar">
      {user?.role === 'ADMIN' ? (
        <button className="ghost" onClick={() => navigate('/admin/users')}>
          Administration
        </button>
      ) : null}
      {user ? <span className="muted">{user.email}</span> : null}
      <button className="ghost" onClick={handleLogout}>
        Log out
      </button>
    </div>
  )
}
