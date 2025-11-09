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

  const response = await fetch('/assets', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error(`Failed to upload asset (${response.status})`)
  }

  return response.json()
}

export async function fetchAssetMeta(assetId: string): Promise<AssetMeta> {
  const response = await fetch(`/assets/${assetId}/meta`)
  if (!response.ok) {
    throw new Error(`Failed to load asset metadata (${response.status})`)
  }
  return response.json()
}

export interface WaitForAssetOptions {
  intervalMs?: number
  timeoutMs?: number
}

export async function waitForAssetReady(assetId: string, options: WaitForAssetOptions = {}) {
  const interval = options.intervalMs ?? 1500
  const timeout = options.timeoutMs ?? 60000
  const start = Date.now()

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const meta = await fetchAssetMeta(assetId)
    if (meta.status === 'READY') {
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
