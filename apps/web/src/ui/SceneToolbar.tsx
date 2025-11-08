import { useCallback } from 'react'
import { useSceneStore } from '../state/scene'

export function SceneToolbar() {
  const createRectangle = useSceneStore((state) => state.createRectangleNode)
  const nodeCount = useSceneStore((state) => state.nodes.length)
  const selectedCount = useSceneStore((state) => state.selectedIds.length)

  const handleCreate = useCallback(() => {
    createRectangle()
  }, [createRectangle])

  return (
    <div className="scene-toolbar" role="toolbar" aria-label="Scene actions">
      <button type="button" className="toolbar-button" onClick={handleCreate}>
        Add Rectangle
      </button>
      <div className="toolbar-stats" aria-live="polite">
        <span>{nodeCount} nodes</span>
        <span>{selectedCount} selected</span>
      </div>
    </div>
  )
}
