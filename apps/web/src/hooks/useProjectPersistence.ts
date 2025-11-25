import { useEffect } from 'react'
import { createProject, fetchProject, updateProject } from '../api/projects'
import { readProjectCache, writeProjectCache } from '../state/projectCache'
import { useSceneStore, type SceneDocument } from '../state/scene'

const LOCAL_STORAGE_KEY = 'scrapbook:lastProjectId'
const SAVE_DEBOUNCE_MS = 1500
const RETRY_DELAY_MS = 4000

interface PersistenceOptions {
  onLoadFailure?: () => void
}

export function useProjectPersistence(projectIdFromRoute?: string | null, options?: PersistenceOptions) {
  const loadSceneDocument = useSceneStore((state) => state.loadSceneDocument)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return () => {}
    }

    let cancelled = false
    const projectIdRef: { current: string | null } = { current: projectIdFromRoute ?? null }
    const initializedRef: { current: boolean } = { current: false }

    // Autosave removed - collaboration (Yjs) handles all persistence
    // Scene changes are synced via WebSocket and saved by the server
    const unsubscribe = useSceneStore.subscribe(() => {
      // Subscription kept for future use (e.g., analytics, logging)
      // No automatic saves - Yjs handles persistence
    })

    const finalize = async (projectId: string, sceneData: SceneDocument | null | undefined) => {
      projectIdRef.current = projectId
      window.localStorage.setItem(LOCAL_STORAGE_KEY, projectId)
      if (sceneData) {
        await writeProjectCache(projectId, sceneData)
      }
      initializedRef.current = true
    }

    const attemptLoad = async (projectId: string) => {
      try {
        const project = await fetchProject(projectId)
        if (cancelled) return true
        loadSceneDocument(project.scene)
        await finalize(project.id, project.scene)
        return true
      } catch (error) {
        console.error('Failed to fetch project', error)
        const cached = await readProjectCache(projectId)
        if (cached && !cancelled) {
          loadSceneDocument(cached)
          await finalize(projectId, cached)
          return true
        }
        if (options?.onLoadFailure) {
          options.onLoadFailure()
        }
        return false
      }
    }

    const initialize = async () => {
      const storedId = projectIdRef.current ?? window.localStorage.getItem(LOCAL_STORAGE_KEY)
      if (storedId) {
        const loaded = await attemptLoad(storedId)
        if (loaded || cancelled) {
          return
        }
        if (!projectIdFromRoute) {
          window.localStorage.removeItem(LOCAL_STORAGE_KEY)
        }
      }

      const initialDocument = useSceneStore.getState().toSceneDocument()
      try {
        const project = await createProject({ name: 'Untitled Project', scene: initialDocument })
        if (cancelled) return
        await finalize(project.id, project.scene ?? initialDocument)
      } catch (error) {
        console.error('Failed to create project', error)
        initializedRef.current = true
      }
    }

    void initialize()

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [loadSceneDocument])
}
