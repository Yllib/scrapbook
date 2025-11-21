import { useToastStore } from '../state/toast'

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  return (
    <div className="toast-viewport" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.variant ?? 'info'}`}>
          <div className="toast__body">
            <strong>{toast.title}</strong>
            {toast.description ? <span className="toast__desc">{toast.description}</span> : null}
          </div>
          <button className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
