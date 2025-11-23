import { useSceneStore } from '../state/scene'
import './ConnectionStatusBadge.css'

export function ConnectionStatusBadge() {
  const status = useSceneStore((s) => s.collabStatus)
  const error = useSceneStore((s) => s.collabError)

  if (status === 'disconnected' && !error) {
    // Don't show badge when normally disconnected (no project open)
    return null
  }

  const getStatusInfo = () => {
    switch (status) {
      case 'connected':
        return {
          icon: '●',
          label: 'Connected',
          className: 'connection-status-badge--connected',
        }
      case 'connecting':
        return {
          icon: '○',
          label: 'Connecting...',
          className: 'connection-status-badge--connecting',
        }
      case 'disconnected':
        return {
          icon: '○',
          label: 'Disconnected',
          className: 'connection-status-badge--disconnected',
        }
      case 'error':
        return {
          icon: '⚠',
          label: error || 'Connection error',
          className: 'connection-status-badge--error',
        }
    }
  }

  const info = getStatusInfo()

  return (
    <div className={`connection-status-badge ${info.className}`} title={info.label}>
      <span className="connection-status-badge__icon">{info.icon}</span>
      <span className="connection-status-badge__label">{info.label}</span>
    </div>
  )
}
