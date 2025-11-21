import { useEffect, useMemo, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react'
import { useSceneStore, getEffectiveScaleFromWorld } from '../state/scene'
import { UI_MIN_SCALE, UI_MAX_SCALE } from '../canvas/viewport/zoomLimits'
import { ZOOM_EVENT } from '../canvas/events'

const ZOOM_MULTIPLIER_FORMAT = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
})

function formatZoomMultiplier(scale: number) {
  if (!Number.isFinite(scale)) return '×—'
  if (scale === 0) return '×0'
  const abs = Math.abs(scale)
  if (abs >= 1e4) {
    return `×${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }
  if (abs <= 1e-3) {
    return `×${abs.toFixed(3)}`
  }
  return `×${ZOOM_MULTIPLIER_FORMAT.format(scale)}`
}

export function ZoomBadge() {
  const effectiveWorldScale = useSceneStore((state) => getEffectiveScaleFromWorld(state.world))
  const zoomDisplay = useMemo(() => formatZoomMultiplier(effectiveWorldScale), [effectiveWorldScale])
  const [editing, setEditing] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const dispatchZoom = (scale: number) => {
    const clamped = Math.min(UI_MAX_SCALE, Math.max(UI_MIN_SCALE, scale))
    window.dispatchEvent(new CustomEvent(ZOOM_EVENT, { detail: clamped }))
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || editing) return
    setInputValue(effectiveWorldScale.toString())
    setEditing(true)
  }

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!editing) {
      dispatchZoom(1)
    }
  }

  const commitInput = () => {
    const parsed = Number.parseFloat(inputValue)
    if (Number.isFinite(parsed) && parsed > 0) {
      dispatchZoom(parsed)
    }
    setEditing(false)
  }

  const cancelInput = () => {
    setEditing(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitInput()
    } else if (event.key === 'Escape') {
      cancelInput()
    }
  }

  return (
    <div
      className="zoom-overlay"
      aria-live="polite"
      aria-label="Zoom level"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      role="button"
      tabIndex={0}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="zoom-overlay__input"
          type="text"
          inputMode="decimal"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onBlur={commitInput}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <span className="zoom-overlay__value">{zoomDisplay}</span>
      )}
    </div>
  )
}
