import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, deleteProject, updateProject, type ProjectRecord } from '../api/projects'
import { Pencil, Trash2, Plus, Link2, Copy, User, Send } from 'lucide-react'
import { addCollaboratorByEmail, listCollaborators, removeCollaborator, type CollaboratorRecord } from '../api/collaborators'
import { useSceneStore } from '../state/scene'
import { TopBar } from '../ui/TopBar'
import { createShareLink, getShareLink, revokeShareLink } from '../api/projects'

type NameDialogState =
  | { open: false }
  | { open: true; mode: 'create'; initial: string }
  | { open: true; mode: 'rename'; projectId: string; initial: string }

type ShareDialogState = {
  open: boolean
  project?: ProjectRecord
  token: string | null
  loading: boolean
  error: string | null
  copying: boolean
}

type ShareCollaboratorDialogState = {
  open: boolean
  project?: ProjectRecord
  email: string
  loading: boolean
  error: string | null
  collaborators: CollaboratorRecord[]
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState>({ open: false })
  const [nameInput, setNameInput] = useState('')
  const [shareDialog, setShareDialog] = useState<ShareDialogState>({ open: false, token: null, loading: false, error: null, copying: false })
  const [shareCollabDialog, setShareCollabDialog] = useState<ShareCollaboratorDialogState>({ open: false, project: undefined, email: '', loading: false, error: null, collaborators: [] })
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const data = await listProjects()
        if (!cancelled) {
          const currentUserId = undefined
          const mapped = data.map((p) => ({
            ...p,
            ownerId: p.ownerId ?? (p as any).owner?.id,
            ownerEmail: p.ownerEmail ?? (p as any).owner?.email,
            currentUserId,
          }))
          setProjects(mapped)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load projects')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const openCreateDialog = () => {
    setNameInput('')
    setNameDialog({ open: true, mode: 'create', initial: 'Untitled Project' })
  }

  const openRenameDialog = (projectId: string, currentName: string) => {
    setNameInput(currentName)
    setNameDialog({ open: true, mode: 'rename', projectId, initial: currentName })
  }

  const openShareDialog = async (project: ProjectRecord) => {
    setShareDialog({ open: true, project, token: null, loading: true, error: null, copying: false })
    try {
      const existing = await getShareLink(project.id)
      setShareDialog({ open: true, project, token: existing, loading: false, error: null, copying: false })
    } catch (err) {
      setShareDialog({ open: true, project, token: null, loading: false, error: err instanceof Error ? err.message : 'Failed to load share link', copying: false })
    }
  }

  const submitNameDialog = async () => {
    const trimmed = (nameInput || '').trim() || 'Untitled Project'
    if (!nameDialog.open) return
    setLoading(true)
    setError(null)
    try {
      if (nameDialog.mode === 'create') {
        const initialDoc = useSceneStore.getState().toSceneDocument()
        const project = await createProject({ name: trimmed, scene: initialDoc })
        setNameDialog({ open: false })
        navigate(`/projects/${project.id}`)
      } else {
        const updated = await updateProject(nameDialog.projectId, { name: trimmed })
        setProjects((list) => list.map((p) => (p.id === nameDialog.projectId ? updated : p)))
        setNameDialog({ open: false })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; projectId?: string; name?: string }>({ open: false })

  const handleDelete = async () => {
    if (!deleteConfirm.projectId) return
    setLoading(true)
    setError(null)
    try {
      await deleteProject(deleteConfirm.projectId)
      setProjects((list) => list.filter((p) => p.id !== deleteConfirm.projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project')
    } finally {
      setDeleteConfirm({ open: false })
      setLoading(false)
    }
  }

  const handleCreateShare = async () => {
    const project = shareDialog.project
    if (!project) return
    setShareDialog((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const token = await createShareLink(project.id)
      setShareDialog((prev) => ({ ...prev, token, loading: false }))
    } catch (err) {
      setShareDialog((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'Failed to create link' }))
    }
  }

  const handleRevokeShare = async () => {
    const project = shareDialog.project
    if (!project) return
    setShareDialog((prev) => ({ ...prev, loading: true, error: null }))
    try {
      await revokeShareLink(project.id)
      setShareDialog((prev) => ({ ...prev, token: null, loading: false }))
    } catch (err) {
      setShareDialog((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'Failed to revoke link' }))
    }
  }

  const handleCopyShare = async () => {
    const url = shareDialog.token ? `${window.location.origin}/view/${shareDialog.token}` : ''
    if (!url) return
    setShareDialog((prev) => ({ ...prev, copying: true }))
    try {
      await navigator.clipboard.writeText(url)
    } catch (err) {
      console.error('Copy failed', err)
    } finally {
      setShareDialog((prev) => ({ ...prev, copying: false }))
    }
  }

  const handleOpenShareCollaborator = async (project: ProjectRecord) => {
    setShareCollabDialog({ open: true, project, email: '', loading: true, error: null, collaborators: [] })
    try {
      const rows = await listCollaborators(project.id)
      setShareCollabDialog({ open: true, project, email: '', loading: false, error: null, collaborators: rows })
    } catch (err) {
      setShareCollabDialog({ open: true, project, email: '', loading: false, error: err instanceof Error ? err.message : 'Failed to load collaborators', collaborators: [] })
    }
  }

  const handleShareCollaborator = async () => {
    const email = shareCollabDialog.email.trim()
    const project = shareCollabDialog.project
    if (!email || !project) return
    setShareCollabDialog((p) => ({ ...p, loading: true, error: null }))
    try {
      await addCollaboratorByEmail(project.id, email, 'EDITOR')
      const rows = await listCollaborators(project.id)
      setShareCollabDialog({ open: true, project, email: '', loading: false, error: null, collaborators: rows })
    } catch (err) {
      setShareCollabDialog((p) => ({ ...p, loading: false, error: err instanceof Error ? err.message : 'Failed to share' }))
    }
  }

  const handleRemoveCollaborator = async (userId: string) => {
    const project = shareCollabDialog.project
    if (!project) return
    setShareCollabDialog((p) => ({ ...p, loading: true, error: null }))
    try {
      await removeCollaborator(project.id, userId)
      const rows = await listCollaborators(project.id)
      setShareCollabDialog((p) => ({ ...p, loading: false, collaborators: rows }))
    } catch (err) {
      setShareCollabDialog((p) => ({ ...p, loading: false, error: err instanceof Error ? err.message : 'Failed to remove' }))
    }
  }

  return (
    <div className="page-shell">
      <div className="page-card">
        <TopBar />
        <div className="page-head">
          <h1>Canvases</h1>
          <button className="primary-icon-button" onClick={openCreateDialog} disabled={loading}>
            <Plus size={18} />
          </button>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        {loading && projects.length === 0 ? <p>Loading…</p> : null}
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <div
                className="project-row"
                style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0, flexWrap: 'nowrap' }}
              >
                <div className="project-left" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
                  <button
                    className="link"
                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
                    onClick={() => navigate(`/projects/${p.id}`)}
                  >
                    {p.name || 'Untitled'}
                  </button>
                  {p.ownerEmail ? (
                    <span className="owner-icon" title={`Owner: ${p.ownerEmail}`}>
                      <User size={14} />
                    </span>
                  ) : null}
                </div>
                <div
                  className="project-meta"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  <span className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Updated {new Date(p.updatedAt).toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="project-actions">
                <button className="project-icon-button ghost" title="Share with collaborator" aria-label="Share with collaborator" onClick={() => handleOpenShareCollaborator(p)}>
                  <Send size={16} />
                </button>
                <button className="project-icon-button ghost" title="Share view link" aria-label="Share view link" onClick={() => openShareDialog(p)}>
                  <Link2 size={16} />
                </button>
                <button className="project-icon-button ghost" title="Rename" aria-label="Rename project" onClick={() => openRenameDialog(p.id, p.name || 'Untitled')}>
                  <Pencil size={16} />
                </button>
                <button
                  className="project-icon-button danger"
                  title="Delete"
                  aria-label="Delete project"
                  onClick={() => setDeleteConfirm({ open: true, projectId: p.id, name: p.name || 'Untitled' })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
          {projects.length === 0 && !loading ? <li className="muted">No projects yet.</li> : null}
        </ul>
        {deleteConfirm.open ? (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>Delete project</h2>
              <p className="muted">{deleteConfirm.name}</p>
              <p className="muted">This cannot be undone.</p>
              <div className="modal-actions">
                <button className="ghost" onClick={() => setDeleteConfirm({ open: false })} disabled={loading}>
                  Cancel
                </button>
                <button className="danger" onClick={handleDelete} disabled={loading}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {nameDialog.open ? (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>{nameDialog.mode === 'create' ? 'Name your canvas' : 'Rename project'}</h2>
              <input
                autoFocus
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Project name"
              />
              <div className="modal-actions">
                <button className="ghost" onClick={() => setNameDialog({ open: false })} disabled={loading}>
                  Cancel
                </button>
                <button onClick={submitNameDialog} disabled={loading}>
                  {nameDialog.mode === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {shareDialog.open ? (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>View-only link</h2>
              <p className="muted">{shareDialog.project?.name || 'Untitled project'}</p>
              {shareDialog.error ? <p className="auth-error">{shareDialog.error}</p> : null}
              {shareDialog.token ? (
                <>
                  <input
                    readOnly
                    value={typeof window !== 'undefined' ? `${window.location.origin}/view/${shareDialog.token}` : shareDialog.token}
                  />
                  <div className="modal-actions">
                    <button className="ghost" onClick={handleCopyShare} disabled={shareDialog.copying}>
                      <Copy size={16} /> Copy URL
                    </button>
                    <button className="danger" onClick={handleRevokeShare} disabled={shareDialog.loading}>
                      Revoke link
                    </button>
                    <button onClick={handleCreateShare} disabled={shareDialog.loading}>
                      Regenerate
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="muted">No active share link</p>
                  <div className="modal-actions">
                    <button onClick={handleCreateShare} disabled={shareDialog.loading}>
                      Create link
                    </button>
                  </div>
                </>
              )}
              <div className="modal-actions">
                <button className="ghost" onClick={() => setShareDialog({ open: false, token: null, loading: false, error: null, project: undefined, copying: false })}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {shareCollabDialog.open ? (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>Share canvas</h2>
              <p className="muted">{shareCollabDialog.project?.name || 'Untitled canvas'}</p>
              {shareCollabDialog.error ? <p className="auth-error">{shareCollabDialog.error}</p> : null}
              <label>
                Collaborator email
                <input
                  type="email"
                  value={shareCollabDialog.email}
                  onChange={(e) => setShareCollabDialog((p) => ({ ...p, email: e.target.value }))}
                  placeholder="user@example.com"
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button className="ghost" onClick={() => setShareCollabDialog({ open: false, project: undefined, email: '', loading: false, error: null, collaborators: [] })}>
                  Cancel
                </button>
                <button onClick={handleShareCollaborator} disabled={!shareCollabDialog.email || shareCollabDialog.loading}>
                  {shareCollabDialog.loading ? <Send className="spin" size={16} /> : <Send size={16} />}
                  Share
                </button>
              </div>

              {shareCollabDialog.collaborators.length > 0 ? (
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shareCollabDialog.collaborators.map((c) => (
                      <tr key={c.userId}>
                        <td>{c.user.email}</td>
                        <td>{c.role}</td>
                        <td className="table-actions">
                          {shareCollabDialog.project?.ownerId && shareCollabDialog.project.ownerId !== c.userId ? (
                            <button className="danger" onClick={() => handleRemoveCollaborator(c.userId)} disabled={shareCollabDialog.loading}>
                              Remove
                            </button>
                          ) : (
                            <span className="muted">Owner</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
