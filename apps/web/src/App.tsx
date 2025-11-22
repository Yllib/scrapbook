import './App.css'
import { useEffect } from 'react'
import { SVGStage } from './canvas/SVGStage'
import { SceneToolbar } from './ui/SceneToolbar'
import { SceneNodeList } from './ui/SceneNodeList'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { UploadOverlay } from './ui/UploadOverlay'
import { useSceneStore } from './state/scene'
import { useProjectPersistence } from './hooks/useProjectPersistence'
import { useNavigate, useParams } from 'react-router-dom'
import { BackToProjectsButton } from './ui/BackToProjectsButton'
import { AssetDropZone } from './ui/AssetDropZone'
import { ToastViewport } from './ui/ToastViewport'

export function App() {
  const backgroundColor = useSceneStore((state) => state.backgroundColor)
  const setViewOnly = useSceneStore((state) => state.setViewOnly)
  const { id } = useParams()
  const navigate = useNavigate()
  useProjectPersistence(id, { onLoadFailure: () => navigate('/projects', { replace: true }) })

  useEffect(() => {
    setViewOnly(false)
  }, [setViewOnly])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty('--bg', backgroundColor)
    document.body.style.backgroundColor = backgroundColor
  }, [backgroundColor])

  return (
    <div className="app-root">
      <BackToProjectsButton />
      <SVGStage />
      <AssetDropZone />
      <SceneToolbar />
      <SceneNodeList />
      <UploadOverlay />
      <ConfirmDialog />
      <ToastViewport />
    </div>
  )
}

export default App
