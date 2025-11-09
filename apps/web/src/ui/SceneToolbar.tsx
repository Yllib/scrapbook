import { useCallback, useMemo, useRef, useState, type ChangeEvent, type ChangeEventHandler } from 'react'
import { useSceneStore } from '../state/scene'
import { uploadAsset, waitForAssetReady } from '../api/assets'

const TRIANGLE_POINTS = [
  { x: 0, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
]

const DEFAULT_FILL = '#38bdf8'
const DEFAULT_STROKE = '#0ea5e9'
const DEFAULT_RECT = { width: 200, height: 160 }
const DEFAULT_ELLIPSE = { width: 200, height: 200 }
const DEFAULT_TRIANGLE = { width: 220, height: 220 }

export function SceneToolbar() {
  const [uploading, setUploading] = useState(false)
  const createShape = useSceneStore((state) => state.createShapeNode)
  const createImage = useSceneStore((state) => state.createImageNode)
  const nodeCount = useSceneStore((state) => state.nodes.length)
  const nodes = useSceneStore((state) => state.nodes)
  const selectedIds = useSceneStore((state) => state.selectedIds)
  const selectedCount = selectedIds.length
  const updateFill = useSceneStore((state) => state.updateSelectedFill)
  const updateStroke = useSceneStore((state) => state.updateSelectedStroke)
  const updateCornerRadius = useSceneStore((state) => state.updateSelectedCornerRadius)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const canUndo = useSceneStore((state) => state.history.past.length > 0)
  const canRedo = useSceneStore((state) => state.history.future.length > 0)
  const lockSelected = useSceneStore((state) => state.lockSelected)
  const deleteNodes = useSceneStore((state) => state.deleteNodes)
  const bringForward = useSceneStore((state) => state.bringSelectedForward)
  const sendBackward = useSceneStore((state) => state.sendSelectedBackward)
  const bringToFront = useSceneStore((state) => state.bringSelectedToFront)
  const sendToBack = useSceneStore((state) => state.sendSelectedToBack)
  const worldScale = useSceneStore((state) => state.world.scale)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  const firstSelected = useMemo(() => {
    if (selectedIds.length === 0) return null
    return nodes.find((node) => node.id === selectedIds[0]) ?? null
  }, [nodes, selectedIds])

  const fillValue = firstSelected?.fill ?? DEFAULT_FILL
  const strokeValue = firstSelected?.stroke?.color ?? DEFAULT_STROKE
  const strokeWidthValue = firstSelected?.stroke?.width ?? 2
  const cornerRadiusValue =
    firstSelected?.type === 'shape' && firstSelected.shape?.kind === 'rectangle'
      ? firstSelected.shape.cornerRadius ?? 0
      : 0

  const canEditCornerRadius =
    selectedCount > 0 &&
    selectedIds.every((id) => {
      const node = nodes.find((candidate) => candidate.id === id)
      return node?.type === 'shape' && node.shape?.kind === 'rectangle'
    })

  const zoomFactor = useMemo(() => (worldScale !== 0 ? 1 / worldScale : 1), [worldScale])

  const handleAddRect = useCallback(() => {
    createShape(
      { kind: 'rectangle', cornerRadius: 0 },
      {
        name: 'Rectangle',
        size: {
          width: DEFAULT_RECT.width * zoomFactor,
          height: DEFAULT_RECT.height * zoomFactor,
        },
      },
    )
  }, [createShape, zoomFactor])

  const handleAddEllipse = useCallback(() => {
    createShape(
      { kind: 'ellipse' },
      {
        name: 'Ellipse',
        size: {
          width: DEFAULT_ELLIPSE.width * zoomFactor,
          height: DEFAULT_ELLIPSE.height * zoomFactor,
        },
      },
    )
  }, [createShape, zoomFactor])

  const handleAddTriangle = useCallback(() => {
    createShape(
      { kind: 'polygon', points: TRIANGLE_POINTS },
      {
        name: 'Triangle',
        size: {
          width: DEFAULT_TRIANGLE.width * zoomFactor,
          height: DEFAULT_TRIANGLE.height * zoomFactor,
        },
      },
    )
  }, [createShape, zoomFactor])

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click()
  }, [])

  const handleUploadFile: ChangeEventHandler<HTMLInputElement> = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      setUploading(true)
      try {
        const { assetId } = await uploadAsset(file)
        const meta = await waitForAssetReady(assetId)
        const intrinsicWidth = meta.width ?? 512
        const intrinsicHeight = meta.height ?? 512
        createImage(
          {
            assetId,
            intrinsicSize: {
              width: intrinsicWidth,
              height: intrinsicHeight,
            },
          },
          {
            name: file.name || 'Image',
            size: {
              width: intrinsicWidth * zoomFactor,
              height: intrinsicHeight * zoomFactor,
            },
          },
        )
      } catch (error) {
        console.error('Failed to upload image asset', error)
        alert('Failed to upload image asset. Please try again.')
      } finally {
        setUploading(false)
        event.target.value = ''
      }
    },
    [createImage, zoomFactor],
  )

  const handleFillChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateFill(event.target.value)
    },
    [updateFill],
  )

  const handleStrokeColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateStroke({ color: event.target.value })
    },
    [updateStroke],
  )

  const handleStrokeWidthChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const width = Number.parseFloat(event.target.value)
      if (!Number.isNaN(width)) {
        updateStroke({ width })
      }
    },
    [updateStroke],
  )

  const handleCornerRadiusChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const radius = Number.parseFloat(event.target.value)
      if (!Number.isNaN(radius)) {
        updateCornerRadius(radius)
      }
    },
    [updateCornerRadius],
  )

  const handleLockSelected = useCallback(() => {
    lockSelected()
  }, [lockSelected])

  const handleDeleteSelected = useCallback(() => {
    if (selectedCount === 0) return
    deleteNodes([...selectedIds])
  }, [deleteNodes, selectedCount, selectedIds])

  const handleBringForward = useCallback(() => {
    bringForward()
  }, [bringForward])

  const handleSendBackward = useCallback(() => {
    sendBackward()
  }, [sendBackward])

  const handleBringToFront = useCallback(() => {
    bringToFront()
  }, [bringToFront])

  const handleSendToBack = useCallback(() => {
    sendToBack()
  }, [sendToBack])

  return (
    <div className="scene-toolbar" role="toolbar" aria-label="Scene actions">
      <div className="toolbar-section">
        <button type="button" className="toolbar-button" onClick={handleAddRect}>
          Rectangle
        </button>
        <button type="button" className="toolbar-button" onClick={handleAddEllipse}>
          Ellipse
        </button>
        <button type="button" className="toolbar-button" onClick={handleAddTriangle}>
          Triangle
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={handleUploadClick}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Upload Image'}
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          onChange={handleUploadFile}
          style={{ display: 'none' }}
        />
      </div>
      <div className="toolbar-section toolbar-colors" aria-label="Selection styling">
        <label className="color-control">
          <span>Fill</span>
          <input type="color" value={fillValue} onChange={handleFillChange} disabled={selectedCount === 0} />
        </label>
        <label className="color-control">
          <span>Stroke</span>
          <input type="color" value={strokeValue} onChange={handleStrokeColorChange} disabled={selectedCount === 0} />
        </label>
        <label className="width-control">
          <span>Width</span>
          <input
            type="number"
            min={0}
            step={1}
            value={strokeWidthValue}
            onChange={handleStrokeWidthChange}
            disabled={selectedCount === 0}
          />
        </label>
        <label className="width-control">
          <span>Radius</span>
          <input
            type="number"
            min={0}
            step={1}
            value={cornerRadiusValue}
            onChange={handleCornerRadiusChange}
            disabled={!canEditCornerRadius}
          />
        </label>
      </div>
      <div className="toolbar-section toolbar-history" aria-label="Undo and redo">
        <button type="button" className="toolbar-button" onClick={undo} disabled={!canUndo}>
          Undo
        </button>
        <button type="button" className="toolbar-button" onClick={redo} disabled={!canRedo}>
          Redo
        </button>
        <button type="button" className="toolbar-button" onClick={handleBringForward} disabled={selectedCount === 0}>
          Forward
        </button>
        <button type="button" className="toolbar-button" onClick={handleSendBackward} disabled={selectedCount === 0}>
          Backward
        </button>
        <button type="button" className="toolbar-button" onClick={handleBringToFront} disabled={selectedCount === 0}>
          To Front
        </button>
        <button type="button" className="toolbar-button" onClick={handleSendToBack} disabled={selectedCount === 0}>
          To Back
        </button>
        <button type="button" className="toolbar-button" onClick={handleLockSelected} disabled={selectedCount === 0}>
          Lock
        </button>
        <button type="button" className="toolbar-button" onClick={handleDeleteSelected} disabled={selectedCount === 0}>
          Delete
        </button>
      </div>
      <div className="toolbar-stats" aria-live="polite">
        <span>{nodeCount} nodes</span>
        <span>{selectedCount} selected</span>
      </div>
    </div>
  )
}
