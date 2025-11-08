import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, TilingSprite, Texture } from 'pixi.js'
import {
  useSceneStore,
  screenToWorld,
  containsPoint,
  getNodeAABB,
  type SceneNode,
  type Vec2,
  type AABB,
} from '../state/scene'
import {
  calculateGroupSelectionOverlay,
  calculateSelectionHandleSizing,
} from './selectionOverlay'

const DPR_CAP = 1.5
const MIN_ZOOM = 1e-6
const MAX_ZOOM = Number.POSITIVE_INFINITY
const NORMALIZE_MIN_SCALE = 0.25
const NORMALIZE_MAX_SCALE = 4
const NORMALIZE_FACTOR = 2
const GRID_SIZE = 64
const DRAG_THRESHOLD = 4
const SELECTION_COLOR = 0x38bdf8

type PointerMode = 'idle' | 'panning' | 'click-select' | 'marquee'

interface NodeVisual {
  container: Container
  body: Graphics
  selection: Graphics
  node: SceneNode
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createGridTexture(size = GRID_SIZE) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Unable to acquire 2D context for grid texture')
  }

  ctx.fillStyle = '#0f172a'
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

export function StageCanvas() {
  const hostRef = useRef<HTMLDivElement>(null)

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
      try {
        await app.init({
          background: '#020617',
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

      cleanupScene = configureScene(app, host, view)
    }

    setup()

    return () => {
      abortController.abort()
      teardown()
    }
  }, [])

  return <div ref={hostRef} className="stage-host" role="presentation" />
}

function configureScene(app: Application, host: HTMLDivElement, view: HTMLCanvasElement) {
  const storeApi = useSceneStore
  const world = new Container()
  world.sortableChildren = true
  const overlay = new Container()
  overlay.eventMode = 'none'
  const gridTexture = createGridTexture()
  const grid = new TilingSprite({
    texture: gridTexture,
    width: app.renderer.width,
    height: app.renderer.height,
  })
  grid.alpha = 1

  app.stage.addChild(grid)
  app.stage.addChild(world)
  app.stage.addChild(overlay)

  const groupSelection = new Graphics()
  groupSelection.visible = false
  groupSelection.eventMode = 'none'
  groupSelection.zIndex = 1_000_000
  world.addChild(groupSelection)

  const marquee = new Graphics()
  marquee.visible = false
  overlay.addChild(marquee)

  addOriginMarker(world)

  world.position.set(app.renderer.width / 2, app.renderer.height / 2)
  view.style.cursor = 'default'

  const nodeVisuals = new Map<string, NodeVisual>()
  let selectedIdSet = new Set(storeApi.getState().selectedIds)

  const pointer: {
    pointerId: number | null
    mode: PointerMode
    startScreen: Vec2
    lastScreen: Vec2
    additive: boolean
    toggle: boolean
    hasDragged: boolean
  } = {
    pointerId: null,
    mode: 'idle',
    startScreen: { x: 0, y: 0 },
    lastScreen: { x: 0, y: 0 },
    additive: false,
    toggle: false,
    hasDragged: false,
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

  const keyboard = {
    spacePressed: false,
  }

  const scaleNodeDimensions = (node: SceneNode, factor: number): SceneNode => ({
    ...node,
    position: { x: node.position.x * factor, y: node.position.y * factor },
    size: { width: node.size.width * factor, height: node.size.height * factor },
  })

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
    if (pointer.mode === 'panning') {
      view.style.cursor = 'grabbing'
      return
    }
    if (pointer.mode === 'marquee') {
      view.style.cursor = 'crosshair'
      return
    }
    if (keyboard.spacePressed) {
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
      -world.position.x / world.scale.x,
      -world.position.y / world.scale.y,
    )
  }

  const updateGroupSelectionOverlay = () => {
    const selectedNodes = storeApi
      .getState()
      .nodes.filter((node) => selectedIdSet.has(node.id))
    const overlayGeometry = calculateGroupSelectionOverlay(selectedNodes)
    if (!overlayGeometry) {
      groupSelection.visible = false
      groupSelection.clear()
      return
    }

    const sizing = calculateSelectionHandleSizing(world.scale.x)

    groupSelection.visible = true
    groupSelection.clear()
    groupSelection.position.set(overlayGeometry.center.x, overlayGeometry.center.y)

    groupSelection.rect(-overlayGeometry.width / 2, -overlayGeometry.height / 2, overlayGeometry.width, overlayGeometry.height)
    groupSelection.stroke({ color: 0xffffff, alpha: 0.65, width: sizing.strokeWidth })

    overlayGeometry.corners.forEach((corner) => {
      groupSelection.circle(corner.x, corner.y, sizing.cornerRadius).fill({ color: 0x38bdf8, alpha: 0.95 })
    })

    overlayGeometry.edges.forEach((edge) => {
      groupSelection.circle(edge.x, edge.y, sizing.edgeRadius).fill({ color: 0x0ea5e9, alpha: 0.85 })
    })
  }

  const redrawSelection = () => {
    const scale = world.scale.x
    nodeVisuals.forEach((visual, id) => {
      drawSelectionOverlay(visual, scale, selectedIdSet.has(id))
    })
    updateGroupSelectionOverlay()
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

    applyRectangleVisual(visual, node)
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
  })

  const ticker = () => updateGrid()
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
    redrawSelection()

    if (touchPointers.size >= 2) {
      resetTouchGestureReference()
    } else {
      touchGesture = null
    }
  }

  const handleTouchPointerDown = (event: PointerEvent) => {
    view.setPointerCapture(event.pointerId)
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
    view.releasePointerCapture(event.pointerId)
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

  const getNodeUnderPoint = (worldPoint: Vec2): SceneNode | null => {
    const nodes = storeApi.getState().nodes
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const node = nodes[index]
      if (containsPoint(getNodeAABB(node), worldPoint)) {
        return node
      }
    }
    return null
  }

  const updateHoverState = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (pointer.mode === 'panning' || pointer.mode === 'marquee') return
    const screenPoint = getScreenPoint(event)
    const worldPoint = screenToWorld(screenPoint, currentWorldTransform())
    const hitNode = getNodeUnderPoint(worldPoint)
    const hitId = hitNode?.id ?? null
    if (hoveredNodeId === hitId) return
    hoveredNodeId = hitId
    updateCursor()
  }

  const handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      handleTouchPointerDown(event)
      return
    }
    if (pointer.pointerId !== null) return
    view.setPointerCapture(event.pointerId)
    hoveredNodeId = null
    pointer.pointerId = event.pointerId
    pointer.startScreen = getScreenPoint(event)
    pointer.lastScreen = pointer.startScreen
    pointer.hasDragged = false

    const shouldPan = keyboard.spacePressed || event.button === 1 || event.button === 2
    if (shouldPan) {
      pointer.mode = 'panning'
      if (event.button === 2) {
        event.preventDefault()
      }
      updateCursor()
      return
    }

    if (event.button !== 0) {
      pointer.mode = 'idle'
      updateCursor()
      return
    }

    pointer.mode = 'click-select'
    pointer.additive = event.shiftKey
    pointer.toggle = event.metaKey || event.ctrlKey
    updateCursor()
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      handleTouchPointerMove(event)
      return
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
    hoveredNodeId = null
    marquee.visible = false
    marquee.clear()
    updateCursor()
  }

  const handlePointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') {
      handleTouchPointerUp(event)
      return
    }
    if (pointer.pointerId !== event.pointerId) return
    view.releasePointerCapture(event.pointerId)

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
    if (event.pointerType === 'touch') {
      handleTouchPointerUp(event)
      return
    }
    if (pointer.pointerId !== event.pointerId) return
    view.releasePointerCapture(event.pointerId)
    clearPointerState()
    updateHoverState(event)
  }

  const handlePointerLeave = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (pointer.pointerId !== null) return
    if (hoveredNodeId === null) return
    hoveredNodeId = null
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
    redrawSelection()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Space') {
      if (!keyboard.spacePressed) {
        keyboard.spacePressed = true
        if (pointer.mode !== 'panning') {
          updateCursor()
        }
      }
      event.preventDefault()
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
  view.addEventListener('contextmenu', (event) => event.preventDefault())
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

function applyRectangleVisual(visual: NodeVisual, node: SceneNode) {
  visual.node = node
  visual.container.position.set(node.position.x, node.position.y)
  visual.container.rotation = node.rotation

  const { width, height } = node.size
  const halfWidth = width / 2
  const halfHeight = height / 2

  visual.body.clear()
  visual.body.roundRect(-halfWidth, -halfHeight, width, height, 12)
  visual.body.fill({ color: 0x1f2937, alpha: 0.92 })
  visual.body.stroke({ color: 0x0f172a, alpha: 0.8, width: 2 })
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
  const strokeWidth = Math.max(1.5, 1.5 / worldScale)
  const handleRadius = Math.max(4, 4 / worldScale)

  overlay.rect(-halfWidth, -halfHeight, width, height)
  overlay.stroke({ color: SELECTION_COLOR, width: strokeWidth, alpha: 0.95 })

  const corners: Vec2[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]

  corners.forEach((corner) => {
    overlay.circle(corner.x, corner.y, handleRadius).fill({ color: SELECTION_COLOR, alpha: 0.9 })
  })
}

function addOriginMarker(world: Container) {
  const crosshair = new Graphics()
  crosshair.stroke({ width: 2, color: 0x38bdf8, alpha: 0.8 })
  crosshair.moveTo(-80, 0)
  crosshair.lineTo(80, 0)
  crosshair.moveTo(0, -80)
  crosshair.lineTo(0, 80)
  crosshair.zIndex = -1000

  const center = new Graphics()
  center.circle(0, 0, 8).fill(0x38bdf8)
  center.zIndex = -999

  world.addChild(crosshair)
  world.addChild(center)
}
