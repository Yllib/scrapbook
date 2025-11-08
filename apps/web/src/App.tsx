import './App.css'
import { StageCanvas } from './canvas/StageCanvas'
import { SceneToolbar } from './ui/SceneToolbar'
import { SceneNodeList } from './ui/SceneNodeList'

export function App() {
  return (
    <div className="app-root">
      <StageCanvas />
      <SceneToolbar />
      <SceneNodeList />
    </div>
  )
}

export default App
