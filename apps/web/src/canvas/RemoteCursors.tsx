import { memo } from 'react'
import { useSceneStore, worldToScreen } from '../state/scene'

type RemoteCursor = {
  id: string
  x: number
  y: number
  color: string
  label: string
}

interface Props {
  cursors: RemoteCursor[]
}

export const RemoteCursors = memo(function RemoteCursors({ cursors }: Props) {
  const world = useSceneStore((s) => s.world)

  return (
    <div className="remote-cursors" aria-hidden>
      {cursors.map((cursor) => {
        const screenPos = worldToScreen({ x: cursor.x, y: cursor.y }, world)
        return (
          <div
            key={cursor.id}
            className="remote-cursor"
            style={{ transform: `translate(${screenPos.x}px, ${screenPos.y}px)`, borderColor: cursor.color, color: cursor.color }}
            title={cursor.label}
          >
            <svg className="cursor-icon" viewBox="0 0 24 24" fill="currentColor" style={{ width: '32px', height: '32px' }}>
              <path d="M3 3L10.07 19.97L12.58 12.58L19.97 10.07L3 3Z" />
            </svg>
          </div>
        )
      })}
    </div>
  )
})
