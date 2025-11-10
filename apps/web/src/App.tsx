import './App.css'
import { StageCanvas } from './canvas/StageCanvas'
import { SceneToolbar } from './ui/SceneToolbar'
import { SceneNodeList } from './ui/SceneNodeList'
import { ConfirmDialog } from './ui/ConfirmDialog'

export function App() {
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
