import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { RequireAuth } from './ui/RequireAuth'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ManageAccessPage } from './pages/ManageAccessPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { ViewOnlyPage } from './pages/ViewOnlyPage'

export function AppRouter() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/view/:token" element={<ViewOnlyPage />} />
        <Route
          path="/projects"
          element={
            <RequireAuth>
              <ProjectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <RequireAuth>
              <App />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAuth>
              <AdminUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="/projects/:id/share"
          element={
            <RequireAuth>
              <ManageAccessPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
