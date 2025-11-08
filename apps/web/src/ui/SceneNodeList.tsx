import { useMemo } from 'react'
import { useSceneStore } from '../state/scene'

export function SceneNodeList() {
  const nodes = useSceneStore((state) => state.nodes)
  const selectedIds = useSceneStore((state) => state.selectedIds)

  const items = useMemo(() => {
    const selectedSet = new Set(selectedIds)
    return nodes.map((node, index) => ({
      id: node.id,
      name: node.name,
      index,
      isSelected: selectedSet.has(node.id),
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    }))
  }, [nodes, selectedIds])

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
          <li key={item.id} className={item.isSelected ? 'selected' : undefined}>
            <span className="label">
              #{item.index + 1} {item.name}
            </span>
            <span className="coords">
              ({item.x}, {item.y})
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
