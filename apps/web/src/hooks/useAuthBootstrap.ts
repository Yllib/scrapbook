import { useEffect } from 'react'
import { fetchMe } from '../api/auth'
import { useAuthStore } from '../state/auth'

export function useAuthBootstrap() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const setLoading = useAuthStore((s) => s.setLoading)
  const reset = useAuthStore((s) => s.reset)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!token || user) return
      setLoading(true)
      try {
        const me = await fetchMe()
        if (!cancelled) setUser(me)
      } catch (error) {
        if (!cancelled) {
          console.error('Auth bootstrap failed', error)
          reset()
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, user, setUser, setLoading, reset])
}
