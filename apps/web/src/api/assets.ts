import { authFetch, API_BASE } from './client'

export type AssetStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'

export interface AssetVariantMeta {
  id: string
  format: string
  width: number
  height: number
  size: number
  mimeType: string
}

export interface AssetTileMeta {
  id: string
  z: number
  x: number
  y: number
  size: number
  mimeType: string
}

export interface AssetMeta {
  id: string
  filename: string
  status: AssetStatus
  width?: number | null
  height?: number | null
  isSvg?: boolean
  variants: AssetVariantMeta[]
  tiles: AssetTileMeta[]
}

export interface UploadAssetResponse {
  assetId: string
  status: AssetStatus
}

export async function uploadAsset(file: File, projectId?: string): Promise<UploadAssetResponse> {
  const formData = new FormData()
  formData.append('file', file)
  if (projectId) {
    formData.append('projectId', projectId)
  }

  const response = await authFetch(`${API_BASE}/assets`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload asset (${response.status})`)
  }

  return response.json()
}

export async function fetchAssetMeta(assetId: string): Promise<AssetMeta> {
  const response = await authFetch(`${API_BASE}/assets/${assetId}/meta`)
  if (!response.ok) {
    throw new Error(`Failed to load asset metadata (${response.status})`)
  }
  return response.json()
}

export interface WaitForAssetOptions {
  intervalMs?: number
  timeoutMs?: number
}

function expectedTileCount(meta: AssetMeta, tileSize = 256): number {
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width <= 0 || height <= 0) return 0

  // Level 0 (full res)
  const level0Cols = Math.max(1, Math.ceil(width / tileSize))
  const level0Rows = Math.max(1, Math.ceil(height / tileSize))

  // Level 1 (single low-res level at 4x downscale, matching tiler scale)
  const SCALE = 4
  const targetW = Math.max(1, Math.ceil(width / SCALE))
  const targetH = Math.max(1, Math.ceil(height / SCALE))
  const level1Cols = Math.max(1, Math.ceil(targetW / tileSize))
  const level1Rows = Math.max(1, Math.ceil(targetH / tileSize))

  return level0Cols * level0Rows + level1Cols * level1Rows
}

export async function waitForAssetReady(assetId: string, options: WaitForAssetOptions = {}) {
  const interval = options.intervalMs ?? 1500
  const timeout = options.timeoutMs ?? 60000
  const start = Date.now()

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const meta = await fetchAssetMeta(assetId)
    const expectedTiles = expectedTileCount(meta)
    const hasTiles = typeof expectedTiles === 'number' && expectedTiles > 0
      ? (meta.tiles?.length ?? 0) >= expectedTiles
      : Boolean(meta.tiles?.length)
    const hasVariants = Boolean(meta.variants?.length)
    const isSvg = Boolean(meta.isSvg)
    if (meta.status === 'READY' && (isSvg || (hasTiles && hasVariants))) {
      return meta
    }
    if (meta.status === 'FAILED') {
      throw new Error('Asset processing failed')
    }
    if (Date.now() - start > timeout) {
      throw new Error('Timed out waiting for asset to process')
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
