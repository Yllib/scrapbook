import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchSharedProject } from '../api/projects'
import { SVGStage } from '../canvas/SVGStage'
import { useSceneStore } from '../state/scene'
import { ToastViewport } from '../ui/ToastViewport'

export function ViewOnlyPage() {
  const { token } = useParams<{ token: string }>()
  const setViewOnly = useSceneStore((s) => s.setViewOnly)
  const loadSceneDocument = useSceneStore((s) => s.loadSceneDocument)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState<string>('')

  const safeToken = useMemo(() => token ?? '', [token])

  useEffect(() => {
    setViewOnly(true)
    return () => setViewOnly(false)
  }, [setViewOnly])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!safeToken) {
        setError('Missing share token')
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const res = await fetchSharedProject(safeToken)
        if (cancelled) return
        setProjectName(res.project.name ?? 'Shared canvas')
        loadSceneDocument(res.project.scene)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Link expired')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [safeToken, loadSceneDocument])

  if (loading) {
    return <div className="auth-shell"><div className="auth-card">Loading shared canvas…</div></div>
  }

  if (error) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>View-only link</h1>
          <p className="auth-error">{error}</p>
          <p><Link to="/login">Sign in</Link> to open your canvases.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-root">
      <div className="view-only-banner">
        <span>View-only — Sign in to edit</span>
        <Link to="/login" className="ghost">Sign in</Link>
      </div>
      <div className="view-only-title">{projectName || 'Shared canvas'}</div>
      <SVGStage />
      <ToastViewport />
    </div>
  )
}
