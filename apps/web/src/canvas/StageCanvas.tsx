import { useCallback, useEffect, useRef, useState } from 'react'
import { Application, Assets, Container, Graphics, Sprite, TilingSprite, Texture } from 'pixi.js'
import {
  useSceneStore,
  screenToWorld,
  type SceneNode,
  type Vec2,
  type AABB,
} from '../state/scene'
import { requestConfirmation } from '../state/dialog'
import {
  calculateGroupSelectionOverlay,
  calculateSelectionHandleSizing,
  type SelectionOverlayGeometry,
} from './selectionOverlay'
import { pickTileLevel } from '../tiles/tileLevels'

const DPR_CAP = 1.5
const MIN_ZOOM = 1e-6
const MAX_ZOOM = Number.POSITIVE_INFINITY
const NORMALIZE_MIN_SCALE = 1e-5
const NORMALIZE_MAX_SCALE = 128
const NORMALIZE_FACTOR = 2
const GRID_SIZE = 64
const DRAG_THRESHOLD = 4
const SELECTION_COLOR = 0x38bdf8
const HANDLE_HIT_PADDING = 2
const HANDLE_HIT_MIN_PX = 18
const MIN_HALF_SIZE = 1
const DEFAULT_FILL_COLOR = 0x38bdf8
const DEFAULT_STROKE_COLOR = 0x0ea5e9
const DEFAULT_POLYGON_POINTS: Vec2[] = [
  { x: 0, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
]
const TILE_PIXEL_SIZE = 256

const assetTextureCache = new Map<string, Texture>()
const assetTexturePromises = new Map<string, Promise<Texture>>()
const tileTextureCache = new Map<string, Texture>()
const tileTexturePromises = new Map<string, Promise<Texture>>()

function fetchAssetTexture(assetId: string) {
  if (assetTextureCache.has(assetId)) {
    return Promise.resolve(assetTextureCache.get(assetId)!)
  }
  if (assetTexturePromises.has(assetId)) {
    return assetTexturePromises.get(assetId)!
  }
  const promise = Assets.load<Texture>(`/assets/${assetId}/variant/webp.webp`)
    .catch(() => Assets.load<Texture>(`/assets/${assetId}/variant/avif.avif`))
    .then((texture) => {
      assetTextureCache.set(assetId, texture)
      assetTexturePromises.delete(assetId)
      return texture
    })
    .catch((error) => {
      assetTexturePromises.delete(assetId)
      throw error
    })
  assetTexturePromises.set(assetId, promise)
  return promise
}

function fetchTileTexture(assetId: string, z: number, x: number, y: number) {
  const cacheKey = `${assetId}:${z}:${x}:${y}`
  if (tileTextureCache.has(cacheKey)) {
    return Promise.resolve(tileTextureCache.get(cacheKey)!)
  }
  if (tileTexturePromises.has(cacheKey)) {
    return tileTexturePromises.get(cacheKey)!
  }
  const promise = Assets.load<Texture>(`/tiles/${assetId}/${z}/${x}/${y}.webp`)
    .catch(() => Assets.load<Texture>(`/tiles/${assetId}/${z}/${x}/${y}.avif`))
    .then((texture) => {
      tileTextureCache.set(cacheKey, texture)
      tileTexturePromises.delete(cacheKey)
      return texture
    })
    .catch((error) => {
      tileTexturePromises.delete(cacheKey)
      throw error
    })
  tileTexturePromises.set(cacheKey, promise)
  return promise
}

type PointerMode =
  | 'idle'
  | 'panning'
  | 'click-select'
  | 'marquee'
  | 'transform-translate'
  | 'transform-scale'
  | 'transform-rotate'

type HandleType = 'corner' | 'edge' | 'rotate'

interface NodeVisual {
  container: Container
  body: Graphics
  selection: Graphics
  node: SceneNode
  image?: Sprite
  tileContainer?: Container
  tiles?: Map<string, Sprite>
  activeTileLevel?: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createGridTexture(size = GRID_SIZE, background = '#0f172a') {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Unable to acquire 2D context for grid texture')
  }

  ctx.fillStyle = background
  ctx.fillRect(0, 0, size, size)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.lineWidth = 1

  ctx.beginPath()
  ctx.moveTo(0, 0.5)
  ctx.lineTo(size, 0.5)
  ctx.moveTo(0.5, 0)
  ctx.lineTo(0.5, size)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(59, 130, 246, 1)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, size - 0.5)
  ctx.lineTo(size, size - 0.5)
  ctx.moveTo(size - 0.5, 0)
  ctx.lineTo(size - 0.5, size)
  ctx.stroke()

  return Texture.from(canvas)
}

function hexColorToNumber(color: string | undefined, fallback: number): number {
  if (!color) return fallback
  let hex = color.trim()
  if (hex.startsWith('#')) {
    hex = hex.slice(1)
  }
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  const value = Number.parseInt(hex, 16)
  if (Number.isNaN(value)) {
    return fallback
  }
  return value
}

function rotateVector(vec: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: vec.x * cos - vec.y * sin,
    y: vec.x * sin + vec.y * cos,
  }
}

function toWorld(overlay: SelectionOverlayGeometry, offset: Vec2): Vec2 {
  const rotated = rotateVector(offset, overlay.rotation)
  return {
    x: overlay.center.x + rotated.x,
    y: overlay.center.y + rotated.y,
  }
}

function toLocal(overlay: SelectionOverlayGeometry, worldPoint: Vec2): Vec2 {
  const rel = {
    x: worldPoint.x - overlay.center.x,
    y: worldPoint.y - overlay.center.y,
  }
  return rotateVector(rel, -overlay.rotation)
}

function worldPointToLocalPoint(worldPoint: Vec2, origin: Vec2, rotation: number): Vec2 {
  const rel = {
    x: worldPoint.x - origin.x,
    y: worldPoint.y - origin.y,
  }
  return rotateVector(rel, -rotation)
}

function isPointInsideOverlay(overlay: SelectionOverlayGeometry, worldPoint: Vec2) {
  const local = toLocal(overlay, worldPoint)
  return Math.abs(local.x) <= overlay.width / 2 && Math.abs(local.y) <= overlay.height / 2
}

function isPointInPolygon(point: Vec2, polygon: Vec2[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

function cloneSceneNode(node: SceneNode): SceneNode {
  return {
    ...node,
    position: { ...node.position },
    size: { ...node.size },
    shape: node.shape
      ? node.shape.kind === 'polygon'
        ? { kind: 'polygon', points: node.shape.points.map((point) => ({ ...point })) }
        : node.shape.kind === 'rectangle'
          ? { kind: 'rectangle', cornerRadius: node.shape.cornerRadius }
          : { kind: 'ellipse' }
      : undefined,
    image: node.image
      ? {
          assetId: node.image.assetId,
          intrinsicSize: { ...node.image.intrinsicSize },
          tileSize: node.image.tileSize,
          grid: node.image.grid ? { ...node.image.grid } : undefined,
        }
      : undefined,
    stroke: node.stroke ? { ...node.stroke } : undefined,
    fill: node.fill,
    aspectRatioLocked: node.aspectRatioLocked,
    locked: node.locked,
    rotation: node.rotation,
    type: node.type,
    id: node.id,
    name: node.name,
  }
}

function cloneSceneNodes(nodes: SceneNode[]) {
  return nodes.map((node) => cloneSceneNode(node))
}

function distanceBetween(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function nodeContainsPoint(node: SceneNode, point: Vec2) {
  const angle = node.rotation ?? 0
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const dx = point.x - node.position.x
  const dy = point.y - node.position.y
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos
  const halfWidth = node.size.width / 2
  const halfHeight = node.size.height / 2
  if (node.type === 'shape' && node.shape) {
    switch (node.shape.kind) {
      case 'ellipse': {
        const normalizedX = localX / halfWidth
        const normalizedY = localY / halfHeight
        return normalizedX * normalizedX + normalizedY * normalizedY <= 1
      }
      case 'polygon': {
        const points = node.shape.points.length >= 3 ? node.shape.points : DEFAULT_POLYGON_POINTS
        const polygon = points.map((pt) => ({
          x: pt.x * node.size.width,
          y: pt.y * node.size.height,
        }))
        return isPointInPolygon({ x: localX, y: localY }, polygon)
      }
      case 'rectangle': {
        if (!node.shape.cornerRadius) {
          return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight
        }
        const radius = Math.min(node.shape.cornerRadius, Math.min(halfWidth, halfHeight))
        const clampedX = Math.max(Math.abs(localX) - (halfWidth - radius), 0)
        const clampedY = Math.max(Math.abs(localY) - (halfHeight - radius), 0)
        return clampedX * clampedX + clampedY * clampedY <= radius * radius
      }
      default:
        return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight
    }
  }
  return Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight
}

const createPointerCaptureHelpers = (view: HTMLCanvasElement) => {
  const setCapture = (pointerId: number) => {
    try {
      if (!view.hasPointerCapture?.(pointerId)) {
        view.setPointerCapture(pointerId)
      }
    } catch {
      // ignore
    }
  }

  const releaseCapture = (pointerId: number) => {
    try {
      if (view.hasPointerCapture?.(pointerId)) {
        view.releasePointerCapture(pointerId)
      } else {
        view.releasePointerCapture(pointerId)
      }
    } catch {
      // ignore
    }
  }

  return { setCapture, releaseCapture }
}

export function StageCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [unlockMenu, setUnlockMenu] = useState<{ x: number; y: number; nodeId: string; name: string } | null>(null)

  const handleUnlockNode = useCallback((nodeId: string) => {
    useSceneStore.getState().unlockNodes([nodeId])
    setUnlockMenu(null)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const abortController = new AbortController()
    let cleanupScene: (() => void) | null = null
    let view: HTMLCanvasElement | null = null
    let initialized = false
    let destroyed = false
    let pendingDestroy = false
    const app = new Application()

    const teardown = () => {
      if (destroyed) return
      if (!initialized) {
        pendingDestroy = true
        return
      }

      destroyed = true

      cleanupScene?.()
      if (view && view.parentElement === host) {
        host.removeChild(view)
      }
      app.destroy(true, { children: true, texture: true, textureSource: true, context: true })
    }

    const setup = async () => {
      const initialBackground = useSceneStore.getState().backgroundColor ?? '#020617'
      try {
        await app.init({
          background: initialBackground,
          resizeTo: host,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio ?? 1, DPR_CAP),
        })
        initialized = true
      } catch (error) {
        console.error('[stage] Failed to init Pixi application', error)
        teardown()
        return
      }

      if (pendingDestroy || abortController.signal.aborted) {
        teardown()
        return
      }

      view = app.canvas as HTMLCanvasElement
      host.appendChild(view)
      view.style.width = '100%'
      view.style.height = '100%'
      view.style.touchAction = 'none'

      cleanupScene = configureScene(app, host, view, setUnlockMenu, initialBackground)
    }

    setup()

    return () => {
      abortController.abort()
      teardown()
    }
  }, [])

  return (
    <>
      <div ref={hostRef} className="stage-host" role="presentation" />
      {unlockMenu && (
        <div
          className="unlock-menu"
          style={{ top: unlockMenu.y + 4, left: unlockMenu.x + 4 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => handleUnlockNode(unlockMenu.nodeId)}>
            Unlock “{unlockMenu.name}”
          </button>
        </div>
      )}
    </>
  )
}

function configureScene(
  app: Application,
  host: HTMLDivElement,
  view: HTMLCanvasElement,
  setUnlockMenu: (value: { x: number; y: number; nodeId: string; name: string } | null) => void,
  initialBackground: string,
) {
  const storeApi = useSceneStore
  const world = new Container()
  world.sortableChildren = true
  const overlay = new Container()
  overlay.eventMode = 'none'
  const gridTexture = createGridTexture(GRID_SIZE, initialBackground)
  const grid = new TilingSprite({
    texture: gridTexture,
    width: app.renderer.width,
    height: app.renderer.height,
  })
  grid.alpha = 1

  app.stage.addChild(grid)
  app.stage.addChild(world)
  app.stage.addChild(overlay)
  grid.visible = storeApi.getState().showGrid

  const { setCapture, releaseCapture } = createPointerCaptureHelpers(view)

  const groupSelection = new Graphics()
  groupSelection.visible = false
  groupSelection.eventMode = 'none'
  groupSelection.zIndex = 1_000_000
  world.addChild(groupSelection)

  const marquee = new Graphics()
  marquee.visible = false
  overlay.addChild(marquee)

  const originMarker = addOriginMarker(world)
  originMarker.visible = storeApi.getState().showOrigin
  grid.visible = storeApi.getState().showGrid

  world.position.set(app.renderer.width / 2, app.renderer.height / 2)
  view.style.cursor = 'default'

  const nodeVisuals = new Map<string, NodeVisual>()
  let selectedIdSet = new Set(storeApi.getState().selectedIds)

  const refreshImageLODs = () => {
    const scale = world.scale.x
    nodeVisuals.forEach((visual) => {
      if (visual.node.type === 'image') {
        renderImageTiles(visual, visual.node, scale)
      }
    })
  }

  let lastWorldScale = world.scale.x

  const pointer = {
    pointerId: null as number | null,
    mode: 'idle' as PointerMode,
    startScreen: { x: 0, y: 0 },
    lastScreen: { x: 0, y: 0 },
    lastWorld: { x: 0, y: 0 },
    additive: false,
    toggle: false,
    hasDragged: false,
    transformCenter: { x: 0, y: 0 },
    lastAngle: 0,
    activeHandle: null as HandleType | null,
    transformStarted: false,
    scaleStartLocal: { x: 1, y: 1 },
    scaleStartHalf: { width: 1, height: 1 },
    scaleLastAbsolute: { x: 1, y: 1 },
    scaleBaseNodes: null as SceneNode[] | null,
    scaleRotation: 0,
    scaleAxis: 'both' as 'both' | 'x' | 'y',
    aspectLock: false,
  }

  const touchPointers = new Map<number, Vec2>()
  let touchGesture:
    | {
        initialScale: number
        initialDistance: number
        initialMidpointWorld: Vec2
      }
    | null = null

  let hoveredNodeId: string | null = null
  let hoveredHandle: HandleType | null = null
  let currentOverlay: SelectionOverlayGeometry | null = null

  const keyboard = {
    spacePressed: false,
  }

  const scaleNodeDimensions = (node: SceneNode, factor: number): SceneNode => {
    const position = { x: node.position.x * factor, y: node.position.y * factor }
    const size = { width: node.size.width * factor, height: node.size.height * factor }

    let shape = node.shape
    if (shape?.kind === 'rectangle') {
      const maxRadius = Math.min(size.width, size.height) / 2
      shape = {
        kind: 'rectangle',
        cornerRadius: Math.min((shape.cornerRadius ?? 0) * factor, maxRadius),
      }
    } else if (shape?.kind === 'polygon') {
      shape = {
        kind: 'polygon',
        points: shape.points.map((point) => ({ ...point })),
      }
    } else if (shape?.kind === 'ellipse') {
      shape = { kind: 'ellipse' }
    }

    const stroke = node.stroke
      ? {
          ...node.stroke,
          width: node.stroke.width * factor,
        }
      : undefined

    return {
      ...node,
      position,
      size,
      shape,
      stroke,
    }
  }

  const currentWorldTransform = () => ({
    position: { x: world.position.x, y: world.position.y },
    scale: world.scale.x,
  })

  const syncWorldTransform = () => {
    storeApi
      .getState()
      .updateWorldTransform({ position: { x: world.position.x, y: world.position.y }, scale: world.scale.x })
  }

  const syncViewport = () => {
    storeApi
      .getState()
      .updateViewport({ width: app.renderer.width, height: app.renderer.height })
  }

  const updateCursor = () => {
    switch (pointer.mode) {
      case 'panning':
      case 'transform-translate':
        view.style.cursor = 'grabbing'
        return
      case 'transform-scale':
        if (pointer.activeHandle === 'edge') {
          view.style.cursor = pointer.scaleAxis === 'x' ? 'ew-resize' : 'ns-resize'
        } else {
          view.style.cursor = 'nwse-resize'
        }
        return
      case 'transform-rotate':
        view.style.cursor = 'grabbing'
        return
      case 'marquee':
        view.style.cursor = 'crosshair'
        return
      default:
        break
    }

    if (keyboard.spacePressed) {
      view.style.cursor = 'grab'
      return
    }

    if (hoveredHandle === 'corner') {
      view.style.cursor = 'nwse-resize'
      return
    }

    if (hoveredHandle === 'edge') {
      view.style.cursor = 'ns-resize'
      return
    }

    if (hoveredHandle === 'rotate') {
      view.style.cursor = 'grab'
      return
    }

    if (hoveredNodeId) {
      view.style.cursor = 'pointer'
      return
    }

    view.style.cursor = 'default'
  }

  const updateGrid = () => {
    grid.width = app.renderer.width
    grid.height = app.renderer.height
    grid.tileScale.set(world.scale.x, world.scale.y)
    grid.tilePosition.set(
      world.position.x / world.scale.x,
      world.position.y / world.scale.y,
    )
  }

  const updateGroupSelectionOverlay = () => {
    const selectedNodes = storeApi
      .getState()
      .nodes.filter((node) => selectedIdSet.has(node.id))
    const overlayGeometry = calculateGroupSelectionOverlay(selectedNodes)
    currentOverlay = overlayGeometry
    if (!overlayGeometry) {
      groupSelection.visible = false
      groupSelection.clear()
      hoveredHandle = null
      return
    }

    const sizing = calculateSelectionHandleSizing(world.scale.x)

    groupSelection.visible = true
    groupSelection.clear()
    groupSelection.position.set(overlayGeometry.center.x, overlayGeometry.center.y)
    groupSelection.rotation = overlayGeometry.rotation

    const halfWidth = overlayGeometry.width / 2
    const halfHeight = overlayGeometry.height / 2

    groupSelection
      .rect(-halfWidth, -halfHeight, overlayGeometry.width, overlayGeometry.height)
      .stroke({ color: 0xffffff, alpha: 0.65, width: sizing.strokeWidth })

    overlayGeometry.corners.forEach((corner) => {
      groupSelection.circle(corner.x, corner.y, sizing.cornerRadius).fill({ color: 0x38bdf8, alpha: 0.95 })
    })

    overlayGeometry.edges.forEach((edge) => {
      groupSelection.circle(edge.x, edge.y, sizing.edgeRadius).fill({ color: 0x0ea5e9, alpha: 0.85 })
    })

    const armLength = 60 / world.scale.x
    const rotationArmStart = -halfHeight
    const rotationArmEnd = rotationArmStart - armLength

    overlayGeometry.rotationHandle = { x: 0, y: rotationArmEnd }

    groupSelection.moveTo(0, rotationArmStart)
    groupSelection.lineTo(0, rotationArmEnd)
    groupSelection.stroke({ color: 0xffffff, alpha: 0.45, width: sizing.strokeWidth })
    groupSelection.circle(0, rotationArmEnd, sizing.rotationRadius).fill({ color: 0xffffff, alpha: 0.85 })
  }

  const detectHandleAtPoint = (worldPoint: Vec2, overlayGeometry: SelectionOverlayGeometry): HandleType | null => {
    const scale = Math.max(Math.abs(world.scale.x), Number.EPSILON)
    const sizing = calculateSelectionHandleSizing(scale)
    const minThreshold = HANDLE_HIT_MIN_PX / scale
    const cornerThreshold = Math.max(sizing.cornerRadius * HANDLE_HIT_PADDING, minThreshold)
    const edgeThreshold = Math.max(sizing.edgeRadius * HANDLE_HIT_PADDING, minThreshold)
    const rotationThreshold = Math.max(sizing.rotationRadius * HANDLE_HIT_PADDING, minThreshold)

    for (const corner of overlayGeometry.corners) {
      if (distanceBetween(worldPoint, toWorld(overlayGeometry, corner)) <= cornerThreshold) {
        return 'corner'
      }
    }

    for (const edge of overlayGeometry.edges) {
      if (distanceBetween(worldPoint, toWorld(overlayGeometry, edge)) <= edgeThreshold) {
        return 'edge'
      }
    }

    if (distanceBetween(worldPoint, toWorld(overlayGeometry, overlayGeometry.rotationHandle)) <= rotationThreshold) {
      return 'rotate'
    }

    return null
  }

  function signOrOne(value: number) {
    return Math.sign(value) || 1
  }

  function getScaleAnchorPoint(
    overlayGeometry: SelectionOverlayGeometry,
    handle: HandleType,
    handleLocalPoint: Vec2,
    axis: 'both' | 'x' | 'y',
  ): Vec2 {
    const halfWidth = overlayGeometry.width / 2
    const halfHeight = overlayGeometry.height / 2

    if (handle === 'corner') {
      const anchorLocal = {
        x: -signOrOne(handleLocalPoint.x) * halfWidth,
        y: -signOrOne(handleLocalPoint.y) * halfHeight,
      }
      return toWorld(overlayGeometry, anchorLocal)
    }

    if (handle === 'edge') {
      if (axis === 'x') {
        const anchorLocal = {
          x: -signOrOne(handleLocalPoint.x) * halfWidth,
          y: 0,
        }
        return toWorld(overlayGeometry, anchorLocal)
      }
      const anchorLocal = {
        x: 0,
        y: -signOrOne(handleLocalPoint.y) * halfHeight,
      }
      return toWorld(overlayGeometry, anchorLocal)
    }

    return { ...overlayGeometry.center }
  }

  const isSelectionAspectLocked = () => {
    const state = storeApi.getState()
    if (state.selectedIds.length === 0) {
      return false
    }
    const selectedSet = new Set(state.selectedIds)
    let found = false
    for (const node of state.nodes) {
      if (!selectedSet.has(node.id)) continue
      if (!node.aspectRatioLocked) {
        return false
      }
      found = true
    }
    return found
  }

  const redrawSelection = () => {
    const scale = world.scale.x
    nodeVisuals.forEach((visual, id) => {
      drawSelectionOverlay(visual, scale, selectedIdSet.has(id))
    })
    updateGroupSelectionOverlay()
  }

  const resetNodesToScaleBaseline = () => {
    const baseline = pointer.scaleBaseNodes
    if (!baseline) return
    storeApi.setState((prev) => ({
      ...prev,
      nodes: cloneSceneNodes(baseline),
    }))
  }

  const upsertNodeVisual = (node: SceneNode, index: number) => {
    let visual = nodeVisuals.get(node.id)
    if (!visual) {
      const container = new Container()
      container.eventMode = 'none'
      container.sortableChildren = false
      container.zIndex = index
      const body = new Graphics()
      const selection = new Graphics()
      selection.visible = false
      selection.eventMode = 'none'
      container.addChild(body)
      container.addChild(selection)
      world.addChild(container)
      visual = { container, body, selection, node }
      nodeVisuals.set(node.id, visual)
    } else {
      visual.node = node
      visual.container.zIndex = index
    }

    renderNodeVisual(visual, node, world.scale.x)
  }

  const removeNodeVisual = (id: string) => {
    const visual = nodeVisuals.get(id)
    if (!visual) return
    world.removeChild(visual.container)
    visual.container.destroy({
      children: true,
    })
    nodeVisuals.delete(id)
  }

  const syncNodes = (nodes: SceneNode[], previous: SceneNode[] = []) => {
    const prevIds = new Set(previous.map((node) => node.id))
    const nextIds = new Set(nodes.map((node) => node.id))
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        removeNodeVisual(id)
      }
    }

    nodes.forEach((node, index) => {
      upsertNodeVisual(node, index)
    })
    world.sortChildren()
    redrawSelection()
  }

  syncViewport()
  syncWorldTransform()
  syncNodes(storeApi.getState().nodes)
  redrawSelection()

  const unsubscribeStore = storeApi.subscribe((state, prevState) => {
    if (state.nodes !== prevState.nodes) {
      syncNodes(state.nodes, prevState.nodes)
    }
    if (state.selectedIds !== prevState.selectedIds) {
      selectedIdSet = new Set(state.selectedIds)
      redrawSelection()
    }
    if (state.showGrid !== prevState.showGrid) {
      grid.visible = state.showGrid
    }
    if (state.showOrigin !== prevState.showOrigin) {
      originMarker.visible = state.showOrigin
    }
    if (state.backgroundColor !== prevState.backgroundColor) {
      const color = hexColorToNumber(state.backgroundColor, 0x020617)
      app.renderer.background.color = color
      const newTexture = createGridTexture(GRID_SIZE, state.backgroundColor ?? '#020617')
      grid.texture.destroy(true)
      grid.texture = newTexture
      grid.tileScale.set(world.scale.x, world.scale.y)
    }
  })

  const ticker = () => {
    updateGrid()
    if (Math.abs(world.scale.x - lastWorldScale) > 1e-4) {
      refreshImageLODs()
      lastWorldScale = world.scale.x
    }
  }
  app.ticker.add(ticker)

  const getScreenPoint = (event: PointerEvent): Vec2 => {
    const rect = view.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const getFirstTwoTouchPoints = () => {
    const iterator = touchPointers.values()
    const first = iterator.next()
    const second = iterator.next()
    if (first.done || second.done) return null
    return [first.value, second.value] as const
  }

  const normalizeWorldScale = () => {
    let adjusted = false

    const shrinkScene = () => {
      world.scale.set(world.scale.x / NORMALIZE_FACTOR)
      storeApi.setState((prev) => ({
        nodes: prev.nodes.map((node) => scaleNodeDimensions(node, NORMALIZE_FACTOR)),
        world: {
          position: { ...prev.world.position },
          scale: world.scale.x,
        },
      }))
      adjusted = true
    }

    const growScene = () => {
      world.scale.set(world.scale.x * NORMALIZE_FACTOR)
      storeApi.setState((prev) => ({
        nodes: prev.nodes.map((node) => scaleNodeDimensions(node, 1 / NORMALIZE_FACTOR)),
        world: {
          position: { ...prev.world.position },
          scale: world.scale.x,
        },
      }))
      adjusted = true
    }

    while (world.scale.x > NORMALIZE_MAX_SCALE) {
      shrinkScene()
    }
    while (world.scale.x < NORMALIZE_MIN_SCALE) {
      growScene()
    }

    if (adjusted) {
      redrawSelection()
      if (touchPointers.size >= 2) {
        resetTouchGestureReference()
      }
      lastWorldScale = world.scale.x
      refreshImageLODs()
      syncWorldTransform()
    }
  }

  const resetTouchGestureReference = () => {
    const pair = getFirstTwoTouchPoints()
    if (!pair) {
      touchGesture = null
      return
    }
    const [a, b] = pair
    const midpoint = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    }
    const distance = Math.hypot(b.x - a.x, b.y - a.y)
    touchGesture = {
      initialScale: world.scale.x,
      initialDistance: Math.max(distance, 1),
      initialMidpointWorld: screenToWorld(midpoint, currentWorldTransform()),
    }
  }

  const applyTouchGesture = () => {
    if (!touchGesture) return
    const pair = getFirstTwoTouchPoints()
    if (!pair) return
    const [a, b] = pair
    const midpoint = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    }
    const distance = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)

    const targetScale = clamp(
      touchGesture.initialScale * (distance / touchGesture.initialDistance),
      MIN_ZOOM,
      MAX_ZOOM,
    )
    world.scale.set(targetScale)
    world.position.set(
      midpoint.x - touchGesture.initialMidpointWorld.x * targetScale,
      midpoint.y - touchGesture.initialMidpointWorld.y * targetScale,
    )
    normalizeWorldScale()
    syncWorldTransform()
    lastWorldScale = world.scale.x
    refreshImageLODs()
    redrawSelection()

    if (touchPointers.size >= 2) {
      resetTouchGestureReference()
    } else {
      touchGesture = null
    }
  }

  const handleTouchPointerDown = (event: PointerEvent) => {
    setCapture(event.pointerId)
    const point = getScreenPoint(event)
    touchPointers.set(event.pointerId, point)
    if (touchPointers.size >= 2) {
      resetTouchGestureReference()
      applyTouchGesture()
    }
  }

  const handleTouchPointerMove = (event: PointerEvent) => {
    if (!touchPointers.has(event.pointerId)) return
    touchPointers.set(event.pointerId, getScreenPoint(event))
    if (touchPointers.size >= 2) {
      applyTouchGesture()
    }
  }

  const handleTouchPointerUp = (event: PointerEvent) => {
    if (!touchPointers.has(event.pointerId)) return
    releaseCapture(event.pointerId)
    touchPointers.delete(event.pointerId)
    if (touchPointers.size >= 2) {
      resetTouchGestureReference()
    } else {
      touchGesture = null
      syncWorldTransform()
    }
  }

  const beginMarquee = () => {
    pointer.mode = 'marquee'
    marquee.visible = true
    marquee.clear()
    updateCursor()
  }

  const updateMarquee = (current: Vec2) => {
    marquee.clear()
    const x = Math.min(pointer.startScreen.x, current.x)
    const y = Math.min(pointer.startScreen.y, current.y)
    const width = Math.abs(current.x - pointer.startScreen.x)
    const height = Math.abs(current.y - pointer.startScreen.y)
    marquee.rect(x, y, width, height)
    marquee.stroke({ color: SELECTION_COLOR, width: 1.5, alpha: 0.9 })
    marquee.fill({ color: SELECTION_COLOR, alpha: 0.12 })
  }

  const finishMarquee = (current: Vec2, additive: boolean) => {
    const transform = currentWorldTransform()
    const startWorld = screenToWorld(pointer.startScreen, transform)
    const endWorld = screenToWorld(current, transform)
    const box: AABB = {
      minX: Math.min(startWorld.x, endWorld.x),
      minY: Math.min(startWorld.y, endWorld.y),
      maxX: Math.max(startWorld.x, endWorld.x),
      maxY: Math.max(startWorld.y, endWorld.y),
    }
    storeApi.getState().marqueeSelect(box, additive)
  }

  const findTopNode = (worldPoint: Vec2, includeLocked = false): SceneNode | null => {
    const nodes = storeApi.getState().nodes
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]
      if (!includeLocked && node.locked) continue
      if (nodeContainsPoint(node, worldPoint)) {
        return node
      }
    }
    return null
  }

  const getNodeUnderPoint = (worldPoint: Vec2): SceneNode | null => findTopNode(worldPoint, false)

  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const rect = view.getBoundingClientRect()
    const screenPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    const worldPoint = screenToWorld(screenPoint, currentWorldTransform())
    const lockedNode = findTopNode(worldPoint, true)
    if (lockedNode && lockedNode.locked) {
      setUnlockMenu({ x: event.clientX, y: event.clientY, nodeId: lockedNode.id, name: lockedNode.name })
    } else {
      setUnlockMenu(null)
    }
  }

  const updateHoverState = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (pointer.pointerId !== null) return

    const screenPoint = getScreenPoint(event)
    const worldPoint = screenToWorld(screenPoint, currentWorldTransform())

    hoveredHandle = null

    if (currentOverlay) {
      const handle = detectHandleAtPoint(worldPoint, currentOverlay)
      if (handle) {
        hoveredHandle = handle
        hoveredNodeId = null
        updateCursor()
        return
      }

      if (isPointInsideOverlay(currentOverlay, worldPoint)) {
        const hitNode = getNodeUnderPoint(worldPoint)
        hoveredNodeId = hitNode?.id ?? null
        updateCursor()
        return
      }
    }

    const hitNode = getNodeUnderPoint(worldPoint)
    const hitId = hitNode?.id ?? null
    if (hoveredNodeId === hitId && hoveredHandle === null) return
    hoveredNodeId = hitId
    updateCursor()
  }

  const handlePointerDown = (event: PointerEvent) => {
    setUnlockMenu(null)
    const isTouch = event.pointerType === 'touch'
    const screenPoint = getScreenPoint(event)
    const worldPoint = screenToWorld(screenPoint, currentWorldTransform())

    if (isTouch) {
      handleTouchPointerDown(event)
      if (touchPointers.size >= 2) {
        return
      }
    }

    if (pointer.pointerId !== null) return
    if (!isTouch) {
      setCapture(event.pointerId)
    }
    pointer.pointerId = event.pointerId
    pointer.startScreen = screenPoint
    pointer.lastScreen = screenPoint
    pointer.lastWorld = worldPoint
    pointer.hasDragged = false
    pointer.additive = event.shiftKey
    pointer.toggle = event.metaKey || event.ctrlKey
    pointer.activeHandle = null
    pointer.transformStarted = false

    const overlayGeometry = currentOverlay
    const state = storeApi.getState()
    const handle = overlayGeometry ? detectHandleAtPoint(worldPoint, overlayGeometry) : null
    const insideOverlay = overlayGeometry ? isPointInsideOverlay(overlayGeometry, worldPoint) : false
    const hitNode = getNodeUnderPoint(worldPoint)

    const shouldPan = !isTouch && (keyboard.spacePressed || event.button === 1 || event.button === 2)
    if (shouldPan) {
      pointer.mode = 'panning'
      if (event.button === 2) {
        event.preventDefault()
      }
      updateCursor()
      return
    }

    if (event.button !== 0 && !isTouch) {
      pointer.mode = 'idle'
      updateCursor()
      return
    }

    if (overlayGeometry && state.selectedIds.length > 0) {
      if (handle === 'rotate') {
        pointer.mode = 'transform-rotate'
        pointer.transformCenter = { ...overlayGeometry.center }
        pointer.lastAngle = Math.atan2(
          worldPoint.y - overlayGeometry.center.y,
          worldPoint.x - overlayGeometry.center.x,
        )
        pointer.hasDragged = true
        pointer.activeHandle = 'rotate'
        hoveredHandle = 'rotate'
        hoveredNodeId = null
        updateCursor()
        return
      }

      if (handle === 'corner' || handle === 'edge') {
        pointer.mode = 'transform-scale'
        pointer.scaleRotation = overlayGeometry.rotation
        pointer.aspectLock = isSelectionAspectLocked()
        pointer.scaleBaseNodes = cloneSceneNodes(storeApi.getState().nodes)
        const localPoint = toLocal(overlayGeometry, worldPoint)
        pointer.scaleAxis =
          handle === 'edge'
            ? Math.abs(localPoint.x) > Math.abs(localPoint.y)
              ? 'x'
              : 'y'
            : 'both'
        const anchor = pointer.aspectLock
          ? { ...overlayGeometry.center }
          : getScaleAnchorPoint(overlayGeometry, handle, localPoint, pointer.scaleAxis)
        pointer.transformCenter = { ...anchor }
        pointer.scaleStartHalf = {
          width: Math.max(overlayGeometry.width / 2, MIN_HALF_SIZE),
          height: Math.max(overlayGeometry.height / 2, MIN_HALF_SIZE),
        }
        const initialLocal = worldPointToLocalPoint(worldPoint, pointer.transformCenter, pointer.scaleRotation)
        const clampLocalValue = (value: number) =>
          Math.abs(value) > 1e-4 ? value : Math.sign(value || 1) * 1e-4
        const clampedX = clampLocalValue(initialLocal.x)
        const clampedY = clampLocalValue(initialLocal.y)
        pointer.scaleStartLocal = { x: clampedX, y: clampedY }
        pointer.scaleLastAbsolute = { x: 1, y: 1 }
        pointer.hasDragged = true
        pointer.activeHandle = handle
        pointer.transformStarted = false
        pointer.lastWorld = worldPoint
        hoveredHandle = handle
        hoveredNodeId = null
        updateCursor()
        return
      }
    }

    if (overlayGeometry && insideOverlay && state.selectedIds.length > 0) {
      pointer.mode = 'transform-translate'
      pointer.transformCenter = { ...overlayGeometry.center }
      pointer.hasDragged = true
      pointer.activeHandle = null
      hoveredHandle = null
      hoveredNodeId = null
      updateCursor()
      return
    }

    if (hitNode && state.selectedIds.includes(hitNode.id)) {
      pointer.mode = 'transform-translate'
      const transformCenter = overlayGeometry?.center ?? hitNode.position
      pointer.transformCenter = { ...transformCenter }
      pointer.hasDragged = true
      pointer.activeHandle = null
      hoveredHandle = null
      hoveredNodeId = null
      updateCursor()
      return
    }

    pointer.mode = 'click-select'
    updateCursor()
  }

  const handlePointerMove = (event: PointerEvent) => {
    const isTouch = event.pointerType === 'touch'
    if (isTouch) {
      handleTouchPointerMove(event)
      if (touchPointers.size >= 2) {
        return
      }
    }
    if (pointer.pointerId === null) {
      updateHoverState(event)
      return
    }
    if (pointer.pointerId !== event.pointerId) return
    const screenPoint = getScreenPoint(event)
    const dx = screenPoint.x - pointer.lastScreen.x
    const dy = screenPoint.y - pointer.lastScreen.y
    pointer.lastScreen = screenPoint
    const worldPoint = screenToWorld(screenPoint, currentWorldTransform())

    switch (pointer.mode) {
      case 'transform-translate': {
        const deltaWorld = {
          x: worldPoint.x - pointer.lastWorld.x,
          y: worldPoint.y - pointer.lastWorld.y,
        }
        if (Math.abs(deltaWorld.x) > 0 || Math.abs(deltaWorld.y) > 0) {
          if (!pointer.transformStarted) {
            storeApi.getState().startTransformSession()
            pointer.transformStarted = true
          }
          storeApi.getState().translateSelected(deltaWorld)
          pointer.lastWorld = worldPoint
        }
        return
      }
      case 'transform-scale': {
        const rotation = pointer.scaleRotation
        const localPoint = worldPointToLocalPoint(worldPoint, pointer.transformCenter, rotation)
        const localX = localPoint.x
        const localY = localPoint.y

        if (!pointer.scaleBaseNodes) {
          pointer.scaleBaseNodes = cloneSceneNodes(storeApi.getState().nodes)
        }

        const minHalf = MIN_HALF_SIZE
        const baseLocalX = pointer.scaleStartLocal.x
        const baseLocalY = pointer.scaleStartLocal.y
        const baseWidth = Math.max(Math.abs(baseLocalX), minHalf)
        const baseHeight = Math.max(Math.abs(baseLocalY), minHalf)
        const baseHalfWidth = Math.max(pointer.scaleStartHalf.width, minHalf)
        const baseHalfHeight = Math.max(pointer.scaleStartHalf.height, minHalf)

        let absoluteScaleX = 1
        let absoluteScaleY = 1

        if (pointer.aspectLock) {
          const minScale = 1e-4
          let uniformScale = 1
          if (pointer.scaleAxis === 'x') {
            uniformScale = Math.max(Math.abs(localX) / baseHalfWidth, minScale)
          } else if (pointer.scaleAxis === 'y') {
            uniformScale = Math.max(Math.abs(localY) / baseHalfHeight, minScale)
          } else {
            const baseDiagonal = Math.max(Math.hypot(baseHalfWidth, baseHalfHeight), minHalf)
            const targetDiagonal = Math.max(Math.hypot(localX, localY), minHalf)
            uniformScale = Math.max(targetDiagonal / baseDiagonal, minScale)
          }
          absoluteScaleX = uniformScale
          absoluteScaleY = uniformScale
        } else {
          if (pointer.scaleAxis !== 'y') {
            const targetWidth = Math.max(Math.abs(localX), minHalf)
            absoluteScaleX = Math.max(targetWidth / baseWidth, 1e-4)
          }
          if (pointer.scaleAxis !== 'x') {
            const targetHeight = Math.max(Math.abs(localY), minHalf)
            absoluteScaleY = Math.max(targetHeight / baseHeight, 1e-4)
          }
          if (pointer.scaleAxis === 'x') {
            absoluteScaleY = 1
          } else if (pointer.scaleAxis === 'y') {
            absoluteScaleX = 1
          }
        }

        const changed =
          Math.abs(absoluteScaleX - pointer.scaleLastAbsolute.x) > 1e-4 ||
          Math.abs(absoluteScaleY - pointer.scaleLastAbsolute.y) > 1e-4
        if (!changed) {
          return
        }
        if (!pointer.transformStarted) {
          storeApi.getState().startTransformSession()
          pointer.transformStarted = true
        }
        resetNodesToScaleBaseline()
        storeApi.getState().scaleSelected(pointer.transformCenter, absoluteScaleX, absoluteScaleY)
        pointer.lastWorld = worldPoint
        pointer.scaleLastAbsolute = {
          x: absoluteScaleX,
          y: absoluteScaleY,
        }
        return
      }
      case 'transform-rotate': {
        const angle = Math.atan2(worldPoint.y - pointer.transformCenter.y, worldPoint.x - pointer.transformCenter.x)
        const deltaAngle = angle - pointer.lastAngle
        if (Math.abs(deltaAngle) > 1e-6) {
          if (!pointer.transformStarted) {
            storeApi.getState().startTransformSession()
            pointer.transformStarted = true
          }
          storeApi.getState().rotateSelected(pointer.transformCenter, deltaAngle)
          pointer.lastAngle = angle
        }
        return
      }
      default:
        break
    }

    pointer.lastWorld = worldPoint

    switch (pointer.mode) {
      case 'panning': {
        world.position.x += dx
        world.position.y += dy
        syncWorldTransform()
        break
      }
      case 'click-select':
      case 'marquee': {
        const distance = Math.hypot(
          screenPoint.x - pointer.startScreen.x,
          screenPoint.y - pointer.startScreen.y,
        )
        if (!pointer.hasDragged && distance > DRAG_THRESHOLD) {
          pointer.hasDragged = true
          beginMarquee()
        }

        if (pointer.mode === 'marquee') {
          updateMarquee(screenPoint)
          finishMarquee(screenPoint, pointer.additive || pointer.toggle)
        }
        break
      }
      default:
        break
    }
  }

  const performClickSelection = (event: PointerEvent, worldPoint: Vec2) => {
    const state = storeApi.getState()
    const hit = getNodeUnderPoint(worldPoint)

    const hasModifier = event.shiftKey || event.metaKey || event.ctrlKey

    if (!hit) {
      if (!hasModifier) {
        state.clearSelection()
      }
      return
    }

    if (event.metaKey || event.ctrlKey) {
      state.toggleSelection(hit.id)
      return
    }

    if (event.shiftKey) {
      if (state.selectedIds.includes(hit.id)) {
        return
      }
      state.setSelection([...state.selectedIds, hit.id])
      return
    }

    state.setSelection([hit.id])
  }

  const clearPointerState = () => {
    pointer.pointerId = null
    pointer.mode = 'idle'
    pointer.hasDragged = false
    pointer.additive = false
    pointer.toggle = false
    pointer.activeHandle = null
    pointer.lastAngle = 0
    pointer.transformStarted = false
    pointer.scaleStartLocal = { x: 1, y: 1 }
    pointer.scaleStartHalf = { width: 1, height: 1 }
    pointer.scaleLastAbsolute = { x: 1, y: 1 }
    pointer.scaleBaseNodes = null
    pointer.scaleRotation = 0
    pointer.scaleAxis = 'both'
    pointer.aspectLock = false
    hoveredHandle = null
    hoveredNodeId = null
    marquee.visible = false
    marquee.clear()
    updateCursor()
  }

  const handlePointerUp = (event: PointerEvent) => {
    const isTouch = event.pointerType === 'touch'
    if (isTouch) {
      handleTouchPointerUp(event)
    }
    if (pointer.pointerId !== event.pointerId) return
    releaseCapture(event.pointerId)

    if (
      pointer.mode === 'transform-translate' ||
      pointer.mode === 'transform-scale' ||
      pointer.mode === 'transform-rotate'
    ) {
      if (pointer.transformStarted) {
        storeApi.getState().commitTransformSession()
      }
      clearPointerState()
      updateHoverState(event)
      return
    }

    if (pointer.mode === 'panning') {
      clearPointerState()
      updateHoverState(event)
      return
    }

    const screenPoint = getScreenPoint(event)
    const additive = pointer.additive || pointer.toggle

    if (pointer.mode === 'marquee') {
      finishMarquee(screenPoint, additive)
    } else if (pointer.mode === 'click-select') {
      const worldPoint = screenToWorld(screenPoint, currentWorldTransform())
      performClickSelection(event, worldPoint)
    }

    clearPointerState()
    updateHoverState(event)
  }

  const handlePointerCancel = (event: PointerEvent) => {
    const isTouch = event.pointerType === 'touch'
    if (isTouch) {
      handleTouchPointerUp(event)
    }
    if (pointer.pointerId !== event.pointerId) return
    releaseCapture(event.pointerId)
    if (
      pointer.mode === 'transform-translate' ||
      pointer.mode === 'transform-scale' ||
      pointer.mode === 'transform-rotate'
    ) {
      if (pointer.transformStarted) {
        storeApi.getState().commitTransformSession()
      }
    }
    clearPointerState()
    updateHoverState(event)
  }

  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (pointer.pointerId !== null) return
    if (hoveredNodeId === null && hoveredHandle === null) return
    hoveredNodeId = null
    hoveredHandle = null
    updateCursor()
  }

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    const zoomDelta = Math.exp(-event.deltaY * 0.0015)
    const currentScale = world.scale.x
    const targetScale = clamp(currentScale * zoomDelta, MIN_ZOOM, MAX_ZOOM)
    const rect = view.getBoundingClientRect()
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    const worldCursorX = (cursorX - world.position.x) / currentScale
    const worldCursorY = (cursorY - world.position.y) / currentScale

    world.scale.set(targetScale)
    world.position.set(cursorX - worldCursorX * targetScale, cursorY - worldCursorY * targetScale)
    normalizeWorldScale()
    syncWorldTransform()
    lastWorldScale = world.scale.x
    refreshImageLODs()
    redrawSelection()
  }

  const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase()
      if (key === 'z') {
        if (event.shiftKey) {
          storeApi.getState().redo()
        } else {
          storeApi.getState().undo()
        }
        event.preventDefault()
        return
      }
      if (key === 'y') {
        storeApi.getState().redo()
        event.preventDefault()
        return
      }
    }

    if (event.code === 'Space') {
      if (!keyboard.spacePressed) {
        keyboard.spacePressed = true
        if (pointer.mode !== 'panning') {
          updateCursor()
        }
      }
      event.preventDefault()
      return
    }

    if (!event.metaKey && !event.ctrlKey && event.key === 'Delete') {
      event.preventDefault()
      const state = storeApi.getState()
      if (state.selectedIds.length > 0) {
        const confirmed =
          typeof window === 'undefined'
            ? true
            : await requestConfirmation({
                title:
                  state.selectedIds.length === 1
                    ? 'Delete selected item?'
                    : `Delete ${state.selectedIds.length} items?`,
                message: 'This will remove the selected nodes permanently.',
                confirmLabel: 'Delete',
                cancelLabel: 'Cancel',
                variant: 'danger',
              })
        if (confirmed) {
          state.deleteNodes([...state.selectedIds])
        }
      }
      return
    }
  }

  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      keyboard.spacePressed = false
      if (pointer.mode !== 'panning') {
        updateCursor()
      }
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    updateGrid()
    syncViewport()
  })
  resizeObserver.observe(host)

  view.addEventListener('pointerdown', handlePointerDown)
  view.addEventListener('pointermove', handlePointerMove)
  view.addEventListener('pointerup', handlePointerUp)
  view.addEventListener('pointercancel', handlePointerCancel)
  view.addEventListener('pointerleave', handlePointerLeave)
  view.addEventListener('wheel', handleWheel, { passive: false })
  view.addEventListener('contextmenu', handleContextMenu)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)

  return () => {
    resizeObserver.disconnect()
    view.removeEventListener('pointerdown', handlePointerDown)
    view.removeEventListener('pointermove', handlePointerMove)
    view.removeEventListener('pointerup', handlePointerUp)
    view.removeEventListener('pointercancel', handlePointerCancel)
    view.removeEventListener('pointerleave', handlePointerLeave)
    view.removeEventListener('wheel', handleWheel)
    view.removeEventListener('contextmenu', handleContextMenu)
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('keyup', handleKeyUp)
    app.ticker.remove(ticker)
    unsubscribeStore()
    grid.destroy()
    marquee.destroy()
    overlay.destroy({
      children: true,
    })
    world.destroy({
      children: true,
    })
  }
}

function ensureImageSprite(visual: NodeVisual) {
  if (!visual.image) {
    const sprite = new Sprite(Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.eventMode = 'none'
    visual.container.addChildAt(sprite, 0)
    visual.image = sprite
  }
  return visual.image
}

function hideImageSprite(visual: NodeVisual) {
  if (visual.image) {
    visual.image.visible = false
  }
  if (visual.tileContainer) {
    visual.tileContainer.visible = false
  }
}

function ensureTileContainer(visual: NodeVisual) {
  if (!visual.tileContainer) {
    const container = new Container()
    container.eventMode = 'none'
    visual.container.addChildAt(container, Math.min(visual.container.children.length, 1))
    visual.tileContainer = container
    visual.tiles = new Map()
  }
  if (!visual.tiles) {
    visual.tiles = new Map()
  }
  return visual.tileContainer
}

function renderNodeVisual(visual: NodeVisual, node: SceneNode, worldScale: number) {
  visual.node = node
  visual.container.position.set(node.position.x, node.position.y)
  visual.container.rotation = node.rotation

  const { width, height } = node.size
  const halfWidth = width / 2
  const halfHeight = height / 2

  if (node.type === 'image' && node.image) {
    visual.body.visible = false
    const sprite = ensureImageSprite(visual)
    sprite.visible = true
    sprite.width = width
    sprite.height = height
    const cached = assetTextureCache.get(node.image.assetId)
    if (cached) {
      sprite.texture = cached
    } else {
      sprite.texture = Texture.WHITE
      fetchAssetTexture(node.image.assetId)
        .then((texture: Texture) => {
          if (visual.image && !visual.image.destroyed && visual.node.image?.assetId === node.image?.assetId) {
            visual.image.texture = texture
          }
        })
        .catch((error: unknown) => {
          console.error('[stage] failed to load asset texture', node.image?.assetId, error)
        })
    }
    renderImageTiles(visual, node, worldScale)
    return
  }

  hideImageSprite(visual)
  visual.body.visible = true

  const fillColor = hexColorToNumber(node.fill, DEFAULT_FILL_COLOR)
  const strokeColor = hexColorToNumber(node.stroke?.color, DEFAULT_STROKE_COLOR)
  const strokeWidth = node.stroke?.width ?? 2

  visual.body.clear()

  const shape = node.type === 'shape' ? node.shape : undefined

  if (shape?.kind === 'rectangle') {
    const radius = Math.min(shape.cornerRadius ?? 0, Math.min(width, height) / 2)
    visual.body.roundRect(-halfWidth, -halfHeight, width, height, radius)
  } else if (shape?.kind === 'ellipse') {
    visual.body.ellipse(0, 0, halfWidth, halfHeight)
  } else if (shape?.kind === 'polygon') {
    const points = shape.points.length >= 3 ? shape.points : DEFAULT_POLYGON_POINTS
    const first = points[0]
    visual.body.moveTo(first.x * width, first.y * height)
    for (let idx = 1; idx < points.length; idx += 1) {
      const pt = points[idx]
      visual.body.lineTo(pt.x * width, pt.y * height)
    }
    visual.body.closePath()
  } else {
    visual.body.roundRect(-halfWidth, -halfHeight, width, height, 12)
  }

  if (node.fill !== null) {
    visual.body.fill({ color: fillColor, alpha: 1 })
  }

  if (strokeWidth > 0) {
    visual.body.stroke({ color: strokeColor, width: strokeWidth, alpha: 1 })
  }
}

function renderImageTiles(visual: NodeVisual, node: SceneNode, worldScale: number) {
  if (!node.image) return
  const intrinsicWidth = Math.max(1, node.image.intrinsicSize.width)
  const intrinsicHeight = Math.max(1, node.image.intrinsicSize.height)
  const tileSize = node.image.tileSize ?? TILE_PIXEL_SIZE
  const derivedMaxLevel =
    node.image.tileLevels && node.image.tileLevels.length > 0
      ? node.image.tileLevels[node.image.tileLevels.length - 1].z
      : 0
  const maxLevel = node.image.maxTileLevel ?? derivedMaxLevel
  const safeScale = Math.max(worldScale, Number.EPSILON)
  const baseDensityX = (node.size.width * safeScale) / intrinsicWidth
  const baseDensityY = (node.size.height * safeScale) / intrinsicHeight
  const baseDensity = Math.min(baseDensityX, baseDensityY)
  const targetLevel = maxLevel > 0 ? pickTileLevel(baseDensity, maxLevel) : 0
  const levelScaleFactor = 2 ** targetLevel
  const levelWidth = Math.max(1, Math.ceil(intrinsicWidth / levelScaleFactor))
  const levelHeight = Math.max(1, Math.ceil(intrinsicHeight / levelScaleFactor))
  const levelInfo = node.image.tileLevels?.find((level) => level.z === targetLevel)
  const cols = levelInfo?.columns ?? Math.max(1, Math.ceil(levelWidth / tileSize))
  const rows = levelInfo?.rows ?? Math.max(1, Math.ceil(levelHeight / tileSize))
  const container = ensureTileContainer(visual)
  const tiles = visual.tiles ?? new Map<string, Sprite>()
  visual.tiles = tiles
  container.visible = true

  if (visual.activeTileLevel !== targetLevel) {
    tiles.forEach((sprite, key) => {
      if (!key.startsWith(`${targetLevel}:`)) {
        sprite.destroy()
        tiles.delete(key)
      }
    })
    visual.activeTileLevel = targetLevel
  }

  const needed = new Set<string>()
  const levelWorldScaleX = (node.size.width / intrinsicWidth) * levelScaleFactor
  const levelWorldScaleY = (node.size.height / intrinsicHeight) * levelScaleFactor

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = `${targetLevel}:${x},${y}`
      needed.add(key)
      let sprite = tiles.get(key)
      if (!sprite) {
        sprite = new Sprite(Texture.WHITE)
        sprite.anchor.set(0.5)
        sprite.eventMode = 'none'
        tiles.set(key, sprite)
        container.addChild(sprite)
      }

      const levelTileWidth = Math.max(1, Math.min(tileSize, levelWidth - x * tileSize))
      const levelTileHeight = Math.max(1, Math.min(tileSize, levelHeight - y * tileSize))
      const displayWidth = Math.max(1, levelTileWidth * levelWorldScaleX)
      const displayHeight = Math.max(1, levelTileHeight * levelWorldScaleY)
      const offsetX = -node.size.width / 2 + x * tileSize * levelWorldScaleX + displayWidth / 2
      const offsetY = -node.size.height / 2 + y * tileSize * levelWorldScaleY + displayHeight / 2

      sprite.position.set(offsetX, offsetY)
      sprite.width = displayWidth
      sprite.height = displayHeight

      const cacheKey = `${node.image.assetId}:${targetLevel}:${x}:${y}`
      const cached = tileTextureCache.get(cacheKey)
      if (cached) {
        sprite.texture = cached
      } else {
        sprite.texture = Texture.WHITE
        fetchTileTexture(node.image.assetId, targetLevel, x, y)
          .then((texture: Texture) => {
            tileTextureCache.set(cacheKey, texture)
            if (!sprite.destroyed) {
              sprite.texture = texture
            }
          })
          .catch((error: unknown) => {
            console.error('[stage] failed to load tile texture', node.image?.assetId, targetLevel, x, y, error)
          })
      }
    }
  }

  tiles.forEach((sprite, key) => {
    if (!needed.has(key)) {
      sprite.destroy()
      tiles.delete(key)
    }
  })
}

function drawSelectionOverlay(visual: NodeVisual, worldScale: number, isSelected: boolean) {
  const overlay = visual.selection
  overlay.clear()
  if (!isSelected) {
    overlay.visible = false
    return
  }

  overlay.visible = true
  const { width, height } = visual.node.size
  const halfWidth = width / 2
  const halfHeight = height / 2
  const sizing = calculateSelectionHandleSizing(worldScale)

  overlay.rect(-halfWidth, -halfHeight, width, height)
  overlay.stroke({ color: SELECTION_COLOR, width: sizing.strokeWidth, alpha: 0.95 })

  const corners: Vec2[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]

  corners.forEach((corner) => {
    overlay.circle(corner.x, corner.y, sizing.cornerRadius).fill({ color: SELECTION_COLOR, alpha: 0.9 })
  })
}

function addOriginMarker(world: Container) {
  const marker = new Container()
  marker.zIndex = -1000

  const crosshair = new Graphics()
  crosshair.stroke({ width: 2, color: 0x38bdf8, alpha: 0.8 })
  crosshair.moveTo(-80, 0)
  crosshair.lineTo(80, 0)
  crosshair.moveTo(0, -80)
  crosshair.lineTo(0, 80)
  crosshair.zIndex = -2

  const center = new Graphics()
  center.circle(0, 0, 8).fill(0x38bdf8)
  center.zIndex = -1

  marker.addChild(crosshair)
  marker.addChild(center)
  world.addChild(marker)
  return marker
}
