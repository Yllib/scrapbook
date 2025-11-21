import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { listCollaborators, addCollaboratorByEmail, removeCollaborator, type CollaboratorRecord } from '../api/collaborators'
import { useAuthStore } from '../state/auth'

export function ManageAccessPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const currentUser = useAuthStore((s) => s.user)
  const [collaborators, setCollaborators] = useState<CollaboratorRecord[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const projectId = useMemo(() => id ?? '', [id])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const rows = await listCollaborators(projectId)
        if (!cancelled) setCollaborators(rows)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load access list')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const handleAdd = async () => {
    if (!projectId || !email) return
    setLoading(true)
    setError(null)
    try {
      await addCollaboratorByEmail(projectId, email, role)
      const rows = await listCollaborators(projectId)
      setCollaborators(rows)
      setEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add collaborator')
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!projectId) return
    await removeCollaborator(projectId, userId)
    setCollaborators((prev) => prev.filter((c) => c.userId !== userId))
  }

  if (!projectId) {
    return <div className="auth-shell"><div className="auth-card">Project id missing</div></div>
  }

  if (!currentUser) {
    return <div className="auth-shell"><div className="auth-card">Sign in required</div></div>
  }

  return (
    <div className="page-shell">
      <div className="page-card">
        <div className="page-head">
          <button className="ghost" onClick={() => navigate(-1)}>&larr; Back</button>
          <h1>Manage access</h1>
        </div>
        <div className="access-form">
          <input
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select value={role} onChange={(e) => setRole(e.target.value as any)}>
            <option value="EDITOR">Editor</option>
            <option value="VIEWER">Viewer</option>
          </select>
          <button onClick={handleAdd} disabled={loading || !email}>
            Add
          </button>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        {loading && collaborators.length === 0 ? <p>Loading…</p> : null}
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>System Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {collaborators.map((c) => (
              <tr key={c.userId}>
                <td>{c.user.email}</td>
                <td>{c.role}</td>
                <td>{c.user.role}</td>
                <td>
                  {c.role === 'OWNER' ? (
                    <span>Owner</span>
                  ) : (
                    <button className="ghost" onClick={() => handleRemove(c.userId)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
