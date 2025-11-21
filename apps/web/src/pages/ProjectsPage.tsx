import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, deleteProject, updateProject, type ProjectRecord } from '../api/projects'
import { Pencil, Trash2, Plus, Link2, Copy } from 'lucide-react'
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

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState>({ open: false })
  const [nameInput, setNameInput] = useState('')
  const [shareDialog, setShareDialog] = useState<ShareDialogState>({ open: false, token: null, loading: false, error: null, copying: false })
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const data = await listProjects()
        if (!cancelled) setProjects(data)
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

  return (
    <div className="page-shell">
      <div className="page-card">
        <TopBar />
        <div className="page-head">
          <h1>Projects</h1>
          <button className="primary-icon-button" onClick={openCreateDialog} disabled={loading}>
            <Plus size={18} />
            <span>New Canvas</span>
          </button>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        {loading && projects.length === 0 ? <p>Loading…</p> : null}
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="link" onClick={() => navigate(`/projects/${p.id}`)}>
                {p.name || 'Untitled'}
              </button>
              <span className="muted">Updated {new Date(p.updatedAt).toLocaleString()}</span>
              <div className="project-actions">
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
      </div>
    </div>
  )
}
