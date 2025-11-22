import { useUploadOverlayStore } from '../state/uploadOverlay'

export function UploadOverlay() {
  const open = useUploadOverlayStore((state) => state.open)
  const message = useUploadOverlayStore((state) => state.message)
  const status = useUploadOverlayStore((state) => state.status)

  if (!open) return null

  return (
    <div className="upload-overlay">
      <div className="upload-overlay__backdrop" />
      <div className="upload-overlay__dialog" role="status" aria-live="assertive">
        <div className="upload-overlay__spinner" aria-hidden />
        <div className="upload-overlay__text">
          <p className="upload-overlay__title">
            {status === 'ready' ? 'Image Ready' : status === 'error' ? 'Upload Failed' : 'Uploading Image'}
          </p>
          <p className="upload-overlay__message">{message}</p>
        </div>
      </div>
    </div>
  )
}
