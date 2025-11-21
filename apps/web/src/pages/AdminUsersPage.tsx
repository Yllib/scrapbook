import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Pencil, Plus, RefreshCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import {
  createUser,
  createUserProject,
  deleteUser,
  deleteUserProject,
  listUserProjects,
  listUsers,
  updateUser,
  updateUserProject,
  type UserRecord,
} from '../api/users'
import type { ProjectRecord } from '../api/projects'
import { useAuthStore } from '../state/auth'
import { useSceneStore } from '../state/scene'

type UserDialogState =
  | { open: false }
  | { open: true; mode: 'create'; form: { email: string; password: string; role: UserRecord['role'] } }
  | { open: true; mode: 'edit'; userId: string; form: { email: string; password: string; role: UserRecord['role'] } }

type ProjectDialogState =
  | { open: false }
  | { open: true; mode: 'create'; name: string }
  | { open: true; mode: 'rename'; projectId: string; name: string }

export function AdminUsersPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userDialog, setUserDialog] = useState<UserDialogState>({ open: false })
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>({ open: false })
  const [userDeleteConfirm, setUserDeleteConfirm] = useState<{ open: boolean; userId?: string; email?: string }>({ open: false })
  const [projectDeleteConfirm, setProjectDeleteConfirm] = useState<{ open: boolean; projectId?: string; name?: string }>({ open: false })

  const currentUser = useAuthStore((s) => s.user)

  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) ?? null, [users, selectedUserId])

  useEffect(() => {
    void refreshUsers()
  }, [])

  useEffect(() => {
    if (users.length > 0 && !selectedUserId) {
      setSelectedUserId(users[0].id)
    }
  }, [users, selectedUserId])

  useEffect(() => {
    if (!selectedUserId) {
      setProjects([])
      return
    }
    void refreshProjects(selectedUserId)
  }, [selectedUserId])

  const refreshUsers = async () => {
    setError(null)
    setLoadingUsers(true)
    try {
      const data = await listUsers()
      setUsers(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoadingUsers(false)
    }
  }

  const refreshProjects = async (userId: string) => {
    setLoadingProjects(true)
    setError(null)
    try {
      const data = await listUserProjects(userId)
      setProjects(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load canvases')
      setProjects([])
    } finally {
      setLoadingProjects(false)
    }
  }

  const openCreateUser = () => {
    setUserDialog({ open: true, mode: 'create', form: { email: '', password: '', role: 'USER' } })
  }

  const openEditUser = (user: UserRecord) => {
    setUserDialog({ open: true, mode: 'edit', userId: user.id, form: { email: user.email, password: '', role: user.role } })
  }

  const submitUserDialog = async () => {
    if (!userDialog.open) return
    setSaving(true)
    setError(null)
    try {
      if (userDialog.mode === 'create') {
        const created = await createUser(userDialog.form)
        setUsers((list) => [...list, created])
        setSelectedUserId(created.id)
      } else {
        const { userId, form } = userDialog
        const payload: Partial<{ role: UserRecord['role']; password: string }> = { role: form.role }
        if (form.password.trim().length > 0) payload.password = form.password
        const updated = await updateUser(userId, payload)
        setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)))
      }
      setUserDialog({ open: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const confirmDeleteUser = async () => {
    if (!userDeleteConfirm.userId) return
    setSaving(true)
    setError(null)
    try {
      await deleteUser(userDeleteConfirm.userId)
      setUsers((list) => list.filter((u) => u.id !== userDeleteConfirm.userId))
      if (selectedUserId === userDeleteConfirm.userId) {
        setSelectedUserId(null)
        setProjects([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(false)
      setUserDeleteConfirm({ open: false })
    }
  }

  const openProjectDialog = (mode: 'create' | 'rename', project?: ProjectRecord) => {
    if (!selectedUserId) return
    if (mode === 'create') {
      setProjectDialog({ open: true, mode, name: 'Untitled Canvas' })
    } else if (project) {
      setProjectDialog({ open: true, mode, projectId: project.id, name: project.name || 'Untitled Canvas' })
    }
  }

  const submitProjectDialog = async () => {
    if (!projectDialog.open || !selectedUserId) return
    setSaving(true)
    setError(null)
    try {
      const name = projectDialog.name.trim() || 'Untitled Canvas'
      if (projectDialog.mode === 'create') {
        const scene = useSceneStore.getState().toSceneDocument()
        const created = await createUserProject(selectedUserId, { name, scene })
        setProjects((list) => [created, ...list])
      } else if (projectDialog.mode === 'rename' && projectDialog.projectId) {
        const updated = await updateUserProject(selectedUserId, projectDialog.projectId, { name })
        setProjects((list) => list.map((p) => (p.id === updated.id ? updated : p)))
      }
      setProjectDialog({ open: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const confirmDeleteProject = async () => {
    if (!projectDeleteConfirm.projectId || !selectedUserId) return
    setSaving(true)
    setError(null)
    try {
      await deleteUserProject(selectedUserId, projectDeleteConfirm.projectId)
      setProjects((list) => list.filter((p) => p.id !== projectDeleteConfirm.projectId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setSaving(false)
      setProjectDeleteConfirm({ open: false })
    }
  }

  if (!currentUser || currentUser.role !== 'ADMIN') {
    return <div className="auth-shell"><div className="auth-card">Access denied</div></div>
  }

  return (
    <div className="page-shell">
      <div className="page-card">
        <div className="top-bar admin-top-bar">
          <button className="ghost" onClick={() => navigate('/projects')}>
            <ArrowLeft size={16} /> Back to canvases
          </button>
          <div className="admin-pill">
            <ShieldCheck size={16} /> Administrator
          </div>
        </div>

        <div className="page-head admin-head">
          <h1>Users & canvases</h1>
          <div className="head-actions">
            <button className="ghost" onClick={refreshUsers} disabled={loadingUsers}>
              <RefreshCcw size={16} />
              Refresh
            </button>
            <button className="primary-icon-button" onClick={openCreateUser} disabled={loadingUsers || saving}>
              <UserPlus size={18} />
              New user
            </button>
          </div>
        </div>

        {error ? <p className="auth-error">{error}</p> : null}

        <div className="admin-grid">
          <section className="admin-panel">
            <div className="panel-head">
              <span className="muted">Directory</span>
              {loadingUsers ? (
                <span className="muted inline-flex"><Loader2 className="spin" size={14} /> Loading users…</span>
              ) : null}
            </div>
            <ul className="user-list">
              {users.map((user) => (
                <li key={user.id} className={user.id === selectedUserId ? 'selected' : ''}>
                  <button className="user-tile" onClick={() => setSelectedUserId(user.id)}>
                    <div>
                      <div className="user-email">{user.email}</div>
                      <div className="muted small">Joined {new Date(user.createdAt).toLocaleDateString()}</div>
                    </div>
                    <span className={`pill ${user.role === 'ADMIN' ? 'pill-strong' : ''}`}>{user.role}</span>
                  </button>
                  <div className="tile-actions">
                    <button className="ghost" onClick={() => openEditUser(user)} aria-label="Edit user">
                      <Pencil size={14} />
                    </button>
                    <button
                      className="danger"
                      onClick={() => setUserDeleteConfirm({ open: true, userId: user.id, email: user.email })}
                      aria-label="Delete user"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
              {users.length === 0 && !loadingUsers ? <li className="muted">No users yet.</li> : null}
            </ul>
          </section>

          <section className="admin-panel detail-panel">
            {!selectedUser ? (
              <div className="muted">Select a user to manage their canvases.</div>
            ) : (
              <>
                <div className="panel-head">
                  <div>
                    <div className="user-email large">{selectedUser.email}</div>
                    <div className="muted small">Created {new Date(selectedUser.createdAt).toLocaleString()}</div>
                  </div>
                  <button className="ghost" onClick={() => openEditUser(selectedUser)}>
                    <Pencil size={16} /> Edit user
                  </button>
                </div>

                <div className="inline-controls">
                  <div className="control">
                    <label>Role</label>
                    <select
                      value={selectedUser.role}
                      onChange={(e) => openEditUser({ ...selectedUser, role: e.target.value as UserRecord['role'] })}
                    >
                      <option value="USER">USER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </div>
                  <div className="control">
                    <label>Quick password reset</label>
                    <button className="ghost" onClick={() => openEditUser(selectedUser)}>
                      Set temporary password
                    </button>
                  </div>
                </div>

                <div className="panel-head space">
                  <h3>Canvases</h3>
                  <button className="primary-icon-button" onClick={() => openProjectDialog('create')} disabled={saving || loadingProjects}>
                    <Plus size={16} />
                    New canvas
                  </button>
                </div>
                {loadingProjects ? <p className="muted inline-flex"><Loader2 className="spin" size={14} /> Loading canvases…</p> : null}
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name || 'Untitled'}</td>
                        <td className="muted">{new Date(p.updatedAt).toLocaleString()}</td>
                        <td className="table-actions">
                          <button className="ghost" onClick={() => openProjectDialog('rename', p)}>
                            <Pencil size={14} />
                          </button>
                          <button
                            className="danger"
                            onClick={() => setProjectDeleteConfirm({ open: true, projectId: p.id, name: p.name || 'Untitled' })}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {projects.length === 0 && !loadingProjects ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          No canvases yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </div>
      </div>

      {userDialog.open ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>{userDialog.mode === 'create' ? 'Create user' : 'Update user'}</h2>
            <label>
              Email
              <input
                type="email"
                value={userDialog.form.email}
                disabled={userDialog.mode === 'edit'}
                onChange={(e) =>
                  setUserDialog((prev) =>
                    prev.open
                      ? { ...prev, form: { ...prev.form, email: e.target.value } }
                      : prev,
                  )
                }
                placeholder="user@example.com"
              />
            </label>
            <label>
              {userDialog.mode === 'create' ? 'Password' : 'Set new password (optional)'}
              <input
                type="password"
                value={userDialog.form.password}
                onChange={(e) =>
                  setUserDialog((prev) =>
                    prev.open
                      ? { ...prev, form: { ...prev.form, password: e.target.value } }
                      : prev,
                  )
                }
                placeholder="At least 8 characters"
              />
            </label>
            <label>
              Role
              <select
                value={userDialog.form.role}
                onChange={(e) =>
                  setUserDialog((prev) =>
                    prev.open
                      ? { ...prev, form: { ...prev.form, role: e.target.value as UserRecord['role'] } }
                      : prev,
                  )
                }
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setUserDialog({ open: false })} disabled={saving}>
                Cancel
              </button>
              <button onClick={submitUserDialog} disabled={saving || (userDialog.mode === 'create' && userDialog.form.password.trim() === '')}>
                {saving ? <Loader2 className="spin" size={16} /> : null}
                {userDialog.mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {projectDialog.open ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>{projectDialog.mode === 'create' ? 'New canvas' : 'Rename canvas'}</h2>
            <input
              autoFocus
              type="text"
              value={projectDialog.name}
              onChange={(e) =>
                setProjectDialog((prev) =>
                  prev.open ? { ...prev, name: e.target.value } : prev,
                )
              }
            />
            <div className="modal-actions">
              <button className="ghost" onClick={() => setProjectDialog({ open: false })} disabled={saving}>
                Cancel
              </button>
              <button onClick={submitProjectDialog} disabled={saving}>
                {saving ? <Loader2 className="spin" size={16} /> : null}
                {projectDialog.mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {userDeleteConfirm.open ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Delete user</h2>
            <p className="muted">{userDeleteConfirm.email}</p>
            <p className="muted">This removes the account permanently.</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setUserDeleteConfirm({ open: false })} disabled={saving}>
                Cancel
              </button>
              <button className="danger" onClick={confirmDeleteUser} disabled={saving}>
                {saving ? <Loader2 className="spin" size={16} /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {projectDeleteConfirm.open ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Delete canvas</h2>
            <p className="muted">{projectDeleteConfirm.name}</p>
            <p className="muted">This cannot be undone.</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setProjectDeleteConfirm({ open: false })} disabled={saving}>
                Cancel
              </button>
              <button className="danger" onClick={confirmDeleteProject} disabled={saving}>
                {saving ? <Loader2 className="spin" size={16} /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
