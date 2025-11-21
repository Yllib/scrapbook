import { useCallback, useState, type DragEvent } from 'react'
import { useParams } from 'react-router-dom'
import { uploadAsset, waitForAssetReady } from '../api/assets'
import { summarizeTileLevels } from '../tiles/tileLevels'
import { useSceneStore } from '../state/scene'
import { toast } from '../state/toast'

export function AssetDropZone() {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const { id: projectId } = useParams()
  const createImage = useSceneStore((state) => state.createImageNode)
  const zoomFactor = 1 / (useSceneStore.getState().world.scale || 1)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      setUploading(true)
      const toastId = toast.info('Uploading image…')
      try {
        const { assetId } = await uploadAsset(file, projectId ?? undefined)
        const meta = await waitForAssetReady(assetId)
        const isSvg = Boolean(meta.isSvg)
        const intrinsicWidth = meta.width ?? 512
        const intrinsicHeight = meta.height ?? 512
        const tileLevels = isSvg ? [] : summarizeTileLevels(meta.tiles)
        const maxTileLevel = tileLevels.length > 0 ? tileLevels[tileLevels.length - 1].z : undefined
        createImage(
          {
            assetId,
            intrinsicSize: { width: intrinsicWidth, height: intrinsicHeight },
            isSvg,
            tileLevels: tileLevels.length > 0 ? tileLevels : undefined,
            maxTileLevel,
          },
          {
            name: file.name || 'Image',
            size: {
              width: intrinsicWidth * zoomFactor,
              height: intrinsicHeight * zoomFactor,
            },
          },
        )
        toast.success('Image ready', file.name)
      } catch (error) {
        console.error('Failed to add image from drop', error)
        toast.error('Upload failed', error instanceof Error ? error.message : undefined)
      } finally {
        setUploading(false)
        toast.dismiss(toastId)
      }
    },
    [createImage, projectId, zoomFactor],
  )

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setDragging(false)
      void handleFiles(event.dataTransfer?.files ?? null)
    },
    [handleFiles],
  )

  return (
    <div
      className={`asset-dropzone ${dragging ? 'asset-dropzone--active' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label="Drop images to upload"
    >
      {dragging || uploading ? (
        <div className="asset-dropzone__overlay">
          <div className="asset-dropzone__card">
            {uploading ? 'Uploading…' : 'Drop image to upload'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
