import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { useSceneStore } from '../state/scene'
import { useDialogStore } from '../state/dialog'

export function SceneNodeList() {
  const nodes = useSceneStore((state) => state.nodes)
  const selectedIds = useSceneStore((state) => state.selectedIds)
  const setSelection = useSceneStore((state) => state.setSelection)
  const deleteNodes = useSceneStore((state) => state.deleteNodes)
  const renameNode = useSceneStore((state) => state.renameNode)
  const requestConfirm = useDialogStore((state) => state.requestConfirm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const items = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return nodes.map((node, index) => ({
      id: node.id,
      name: node.name,
      index,
      isSelected: selectedSet.has(node.id),
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      locked: node.locked,
    }))
  }, [nodes, selectedIds])

  const handleSelect = useCallback(
    (id: string) => {
      setSelection([id])
    },
    [setSelection],
  )

  const handleDelete = useCallback(
    async (id: string, name: string, locked: boolean) => {
      if (locked) return
      const confirmed = await requestConfirm({
        title: `Delete ${name}?`,
        message: 'This will remove the node permanently.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      })
      if (!confirmed) return
      deleteNodes([id])
    },
    [deleteNodes, requestConfirm],
  )

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditingValue('')
  }, [])

  const commitRename = useCallback(() => {
    if (!editingId) return
    const trimmed = editingValue.trim()
    if (trimmed.length > 0) {
      renameNode(editingId, trimmed)
    }
    cancelRename()
  }, [editingId, editingValue, renameNode, cancelRename])

  const beginRename = useCallback(
    (id: string, currentName: string, locked: boolean) => {
      if (locked) return
      setEditingId(id)
      setEditingValue(currentName)
      setSelection([id])
    },
    [setSelection],
  )

  const handleRenameInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setEditingValue(event.target.value)
  }, [])

  const handleRenameSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      commitRename()
    },
    [commitRename],
  )

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRename()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        commitRename()
      }
    },
    [cancelRename, commitRename],
  )

  if (items.length === 0) {
    return (
      <div className="scene-debug">
        <header>Scene Nodes</header>
        <p className="empty">No nodes yet — add one to get started.</p>
      </div>
    )
  }

  return (
    <div className="scene-debug">
      <header>Scene Nodes</header>
      <ol>
        {[...items].reverse().map((item) => (
          <li
            key={item.id}
            className={item.isSelected ? 'selected' : undefined}
            onClick={() => handleSelect(item.id)}
          >
            <div className="scene-node-main">
              {editingId === item.id ? (
                <form
                  className="scene-node-rename"
                  onSubmit={handleRenameSubmit}
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    className="scene-node-rename-input"
                    value={editingValue}
                    onChange={handleRenameInput}
                    onKeyDown={handleRenameKeyDown}
                    autoFocus
                    onBlur={commitRename}
                    aria-label="Rename node"
                  />
                </form>
              ) : (
                <span className="label">
                  #{item.index + 1} {item.name}
                </span>
              )}
              <span className="coords">
                ({item.x}, {item.y})
              </span>
            </div>
            <div className="scene-node-actions" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="scene-node-action scene-node-action--rename"
                onClick={() => beginRename(item.id, item.name, item.locked)}
                disabled={item.locked}
                aria-label="Rename node"
              >
                <EditIcon />
              </button>
              <button
                type="button"
                className="scene-node-action scene-node-action--delete"
                onClick={() => handleDelete(item.id, item.name, item.locked)}
                disabled={item.locked}
                aria-label="Delete node"
              >
                <MiniTrashIcon />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function MiniTrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
