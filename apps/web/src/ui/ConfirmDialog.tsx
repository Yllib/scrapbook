import { useEffect, useRef } from 'react'
import { useDialogStore } from '../state/dialog'

export function ConfirmDialog() {
  const isOpen = useDialogStore((state) => state.isOpen)
  const title = useDialogStore((state) => state.title)
  const message = useDialogStore((state) => state.message)
  const confirmLabel = useDialogStore((state) => state.confirmLabel)
  const cancelLabel = useDialogStore((state) => state.cancelLabel)
  const variant = useDialogStore((state) => state.variant)
  const confirm = useDialogStore((state) => state.confirm)
  const cancel = useDialogStore((state) => state.cancel)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    const id = window.setTimeout(() => confirmButtonRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.clearTimeout(id)
    }
  }, [isOpen, cancel])

  if (!isOpen) {
    return null
  }

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={cancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-button confirm-button--ghost" onClick={cancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-button${variant === 'danger' ? ' confirm-button--danger' : ''}`}
            onClick={confirm}
            ref={confirmButtonRef}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
