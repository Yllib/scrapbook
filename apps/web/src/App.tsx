import './App.css'
import { useEffect } from 'react'
import { StageCanvas } from './canvas/StageCanvas'
import { SceneToolbar } from './ui/SceneToolbar'
import { SceneNodeList } from './ui/SceneNodeList'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { useSceneStore } from './state/scene'

export function App() {
  const backgroundColor = useSceneStore((state) => state.backgroundColor)

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.style.setProperty('--bg', backgroundColor)
    document.body.style.backgroundColor = backgroundColor
  }, [backgroundColor])

  return (
    <div className="app-root">
      <StageCanvas />
      <SceneToolbar />
      <SceneNodeList />
      <ConfirmDialog />
    </div>
  )
}

export default App
