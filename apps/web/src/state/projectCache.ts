import { del, get, set } from 'idb-keyval'
import type { SceneDocument } from './scene'

const CACHE_PREFIX = 'scrapbook:project:'

const getCacheKey = (projectId: string) => `${CACHE_PREFIX}${projectId}`

export async function readProjectCache(projectId: string): Promise<SceneDocument | null> {
  try {
    const value = await get<SceneDocument>(getCacheKey(projectId))
    return value ?? null
  } catch (error) {
    console.error('Failed to read project cache', error)
    return null
  }
}

export async function writeProjectCache(projectId: string, document: SceneDocument): Promise<void> {
  try {
    await set(getCacheKey(projectId), document)
  } catch (error) {
    console.error('Failed to write project cache', error)
  }
}

export async function deleteProjectCache(projectId: string): Promise<void> {
  try {
    await del(getCacheKey(projectId))
  } catch (error) {
    console.error('Failed to delete project cache', error)
  }
}
