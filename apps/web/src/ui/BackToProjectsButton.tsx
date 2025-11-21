import { useNavigate } from 'react-router-dom'

export function BackToProjectsButton() {
  const navigate = useNavigate()
  return (
    <button
      className="back-to-projects"
      onClick={() => navigate('/projects')}
      aria-label="Back to projects"
      title="Back to projects"
    >
      ← Projects
    </button>
  )
}
