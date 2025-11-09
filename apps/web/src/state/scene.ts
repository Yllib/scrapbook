import { create } from 'zustand'

export type SceneNodeType = 'rectangle' | 'shape'
export type ShapeType = 'rectangle' | 'ellipse' | 'polygon'

export interface Vec2 {
  x: number
  y: number
}

export interface Size2D {
  width: number
  height: number
}

export interface SceneNode {
  id: string
  type: SceneNodeType
  name: string
  position: Vec2
  size: Size2D
  rotation: number
  shape?: ShapeDefinition
  fill?: string
  stroke?: {
    color: string
    width: number
  }
  locked: boolean
}

export type ShapeDefinition =
  | {
      kind: 'rectangle'
      cornerRadius: number
    }
  | {
      kind: 'ellipse'
    }
  | {
      kind: 'polygon'
      points: Vec2[]
    }

export interface AABB {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface WorldTransform {
  position: Vec2
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

const DEFAULT_RECT_SIZE: Size2D = { width: 160, height: 120 }
const HISTORY_LIMIT = 200
const MIN_NODE_SIZE = 2
const DEFAULT_FILL = '#38bdf8'
const DEFAULT_STROKE = '#0ea5e9'
const DEFAULT_POLYGON_POINTS: Vec2[] = [
  { x: 0, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
]

interface SceneSnapshot {
  nodes: SceneNode[]
  selectedIds: string[]
  world: WorldTransform
}

interface HistoryState {
  past: SceneSnapshot[]
  future: SceneSnapshot[]
  recording: boolean
}

interface SceneState {
  nodes: SceneNode[]
  selectedIds: string[]
  lastSelectedId: string | null
  world: WorldTransform
  viewport: Viewport
  createRectangleNode: (overrides?: Partial<Omit<SceneNode, 'type'>>) => SceneNode
  createShapeNode: (shape: ShapeDefinition, overrides?: Partial<Omit<SceneNode, 'type' | 'shape'>>) => SceneNode
  deleteNodes: (ids: string[]) => void
  clearSelection: () => void
  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void
  marqueeSelect: (box: AABB, additive: boolean) => void
  updateWorldTransform: (transform: Partial<WorldTransform>) => void
  updateViewport: (viewport: Partial<Viewport>) => void
  getWorldCenter: () => Vec2
  startTransformSession: () => void
  commitTransformSession: () => void
  translateSelected: (delta: Vec2, options?: { record?: boolean }) => void
  scaleSelected: (center: Vec2, scaleFactor: number, options?: { record?: boolean }) => void
  rotateSelected: (center: Vec2, deltaRadians: number, options?: { record?: boolean }) => void
  updateSelectedFill: (color: string) => void
  updateSelectedStroke: (stroke: Partial<{ color: string; width: number }>) => void
  updateSelectedCornerRadius: (cornerRadius: number) => void
  lockSelected: () => void
  unlockNodes: (ids: string[]) => void
  bringSelectedForward: () => void
  sendSelectedBackward: () => void
  bringSelectedToFront: () => void
  sendSelectedToBack: () => void
  undo: () => void
  redo: () => void
  history: HistoryState
}

const unique = (values: string[]) => {
  const seen = new Set<string>()
  return values.filter((value) => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

const clampSelectionToNodes = (ids: string[], nodes: SceneNode[]) => {
  const existing = new Set(nodes.map((node) => node.id))
  return unique(ids.filter((id) => existing.has(id)))
}

const cloneShapeDefinition = (shape: ShapeDefinition): ShapeDefinition =>
  shape.kind === 'polygon'
    ? {
        kind: 'polygon',
        points: shape.points.map((point) => ({ ...point })),
      }
    : { ...shape }

const sanitizeShapeDefinition = (shape: ShapeDefinition | undefined): ShapeDefinition | undefined => {
  if (!shape) return undefined
  if (shape.kind === 'rectangle') {
    const cornerRadius = Math.max(0, shape.cornerRadius ?? 0)
    return { kind: 'rectangle', cornerRadius }
  }
  if (shape.kind === 'ellipse') {
    return { kind: 'ellipse' }
  }
  const points = shape.points?.length ? shape.points : DEFAULT_POLYGON_POINTS
  const sanitized = points.map((point) => ({ x: point.x, y: point.y }))
  return {
    kind: 'polygon',
    points: sanitized,
  }
}

const scaleShapeDefinition = (
  shape: ShapeDefinition | undefined,
  scaleFactor: number,
  width: number,
  height: number,
): ShapeDefinition | undefined => {
  if (!shape) return undefined
  if (shape.kind === 'rectangle') {
    const scaledRadius = (shape.cornerRadius ?? 0) * scaleFactor
    const maxRadius = Math.min(width, height) / 2
    return { kind: 'rectangle', cornerRadius: Math.min(scaledRadius, maxRadius) }
  }
  if (shape.kind === 'ellipse') {
    return { kind: 'ellipse' }
  }
  return {
    kind: 'polygon',
    points: shape.points.map((point) => ({ ...point })),
  }
}

const cloneNode = (node: SceneNode): SceneNode => ({
  ...node,
  position: { ...node.position },
  size: { ...node.size },
  shape: node.shape ? cloneShapeDefinition(node.shape) : undefined,
  stroke: node.stroke ? { ...node.stroke } : undefined,
  locked: node.locked,
})

const cloneNodes = (nodes: SceneNode[]) => nodes.map((node) => cloneNode(node))

const cloneWorld = (world: WorldTransform): WorldTransform => ({
  position: { ...world.position },
  scale: world.scale,
})

const createSnapshot = (state: SceneState): SceneSnapshot => ({
  nodes: cloneNodes(state.nodes),
  selectedIds: [...state.selectedIds],
  world: cloneWorld(state.world),
})

const pushSnapshot = (history: HistoryState, snapshot: SceneSnapshot, recording?: boolean) => {
  const past = [...history.past, snapshot]
  if (past.length > HISTORY_LIMIT) {
    past.shift()
  }
  return {
    past,
    future: [],
    recording: recording ?? history.recording,
  }
}

export const useSceneStore = create<SceneState>((set, get) => ({
  nodes: [],
  selectedIds: [],
  lastSelectedId: null,
  world: {
    position: { x: 0, y: 0 },
    scale: 1,
  },
  viewport: {
    width: 0,
    height: 0,
  },
  history: {
    past: [],
    future: [],
    recording: false,
  },
  createRectangleNode: (overrides = {}) => {
    const state = get()
    const center = overrides.position ?? state.getWorldCenter()
    const size = overrides.size ?? DEFAULT_RECT_SIZE
    return state.createShapeNode(
      { kind: 'rectangle', cornerRadius: 0 },
      {
        id: overrides.id,
        name: overrides.name ?? `Rectangle ${state.nodes.length + 1}`,
        position: center,
        size,
        rotation: overrides.rotation,
        fill: overrides.fill,
        stroke: overrides.stroke,
        locked: overrides.locked,
      },
    )
  },
  createShapeNode: (shape, overrides = {}) => {
    const id = overrides.id ?? crypto.randomUUID()
    const state = get()
    const center = overrides.position ?? state.getWorldCenter()
    const scale = state.world.scale || 1
    const factor = 1 / scale
    const size = overrides.size ?? { width: DEFAULT_RECT_SIZE.width * factor, height: DEFAULT_RECT_SIZE.height * factor }
    const shapeDef = sanitizeShapeDefinition(shape) ?? { kind: 'rectangle', cornerRadius: 0 }
    const strokeOverrides = overrides.stroke
    const node: SceneNode = {
      id,
      type: 'shape',
      name: overrides.name ?? `Shape ${state.nodes.length + 1}`,
      position: { x: center.x, y: center.y },
      size: { width: size.width, height: size.height },
      rotation: overrides.rotation ?? 0,
      shape: cloneShapeDefinition(shapeDef),
      fill: overrides.fill ?? DEFAULT_FILL,
      stroke: strokeOverrides
        ? {
            color: strokeOverrides.color ?? DEFAULT_STROKE,
            width: (strokeOverrides.width ?? 2) * factor,
          }
        : { color: DEFAULT_STROKE, width: 2 * factor },
      locked: overrides.locked ?? false,
    }

    set((prev) => {
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      const nodes = [...prev.nodes, node]
      return {
        nodes,
        selectedIds: [id],
        lastSelectedId: id,
        history,
      }
    })

    return node
  },
  deleteNodes: (ids) => {
    if (ids.length === 0) return
    set((prev) => {
      const toDelete = new Set(ids)
      const nodes = prev.nodes.filter((node) => !toDelete.has(node.id))
      const selectedIds = prev.selectedIds.filter((id) => !toDelete.has(id))
      const lastSelectedId = selectedIds.includes(prev.lastSelectedId ?? '')
        ? prev.lastSelectedId
        : selectedIds.at(-1) ?? null
      return {
        nodes,
        selectedIds,
        lastSelectedId,
        history: !prev.history.recording
          ? pushSnapshot(prev.history, createSnapshot(prev))
          : prev.history,
      }
    })
  },
  clearSelection: () => set({ selectedIds: [], lastSelectedId: null }),
  setSelection: (ids) =>
    set((prev) => {
      const selectedIds = clampSelectionToNodes(ids, prev.nodes.filter((node) => !node.locked))
      return {
        selectedIds,
        lastSelectedId: selectedIds.at(-1) ?? null,
      }
    }),
  toggleSelection: (id) =>
    set((prev) => {
      if (prev.selectedIds.includes(id)) {
        const selectedIds = prev.selectedIds.filter((selectedId) => selectedId !== id)
        return {
          selectedIds,
          lastSelectedId: selectedIds.at(-1) ?? null,
        }
      }

      const nodeExists = prev.nodes.some((node) => node.id === id && !node.locked)
      if (!nodeExists) return {}

      return {
        selectedIds: [...prev.selectedIds, id],
        lastSelectedId: id,
      }
    }),
  marqueeSelect: (box, additive) =>
    set((prev) => {
      const intersecting = prev.nodes
        .filter((node) => !node.locked && intersectsAABB(box, getNodeAABB(node)))
        .map((node) => node.id)
      if (intersecting.length === 0) {
        return additive ? {} : { selectedIds: [], lastSelectedId: null }
      }
      const selectedIds = additive
        ? unique([...prev.selectedIds, ...intersecting])
        : unique(intersecting)
      return {
        selectedIds,
        lastSelectedId: selectedIds.at(-1) ?? null,
      }
    }),
  updateWorldTransform: (transform) =>
    set((prev) => ({
      world: {
        position: transform.position ? { ...transform.position } : { ...prev.world.position },
        scale: transform.scale ?? prev.world.scale,
      },
    })),
  updateViewport: (viewport) =>
    set((prev) => ({
      viewport: {
        width: viewport.width ?? prev.viewport.width,
        height: viewport.height ?? prev.viewport.height,
      },
    })),
  startTransformSession: () =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      if (prev.history.recording) return prev
      const history = pushSnapshot(prev.history, createSnapshot(prev), true)
      return { history }
    }),
  commitTransformSession: () =>
    set((prev) => {
      if (!prev.history.recording) return prev
      return {
        history: {
          past: prev.history.past,
          future: prev.history.future,
          recording: false,
        },
      }
    }),
  translateSelected: (delta, options) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      if (delta.x === 0 && delta.y === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const nodes = prev.nodes.map((node) =>
        selectedSet.has(node.id)
          ? {
              ...node,
              position: {
                x: node.position.x + delta.x,
                y: node.position.y + delta.y,
              },
            }
          : node,
      )
      const shouldRecord = options?.record ?? false
      const history = shouldRecord && !prev.history.recording
        ? pushSnapshot(prev.history, createSnapshot(prev))
        : prev.history
      return { nodes, history }
    }),
  scaleSelected: (center, scaleFactor, options) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      if (!Number.isFinite(scaleFactor) || scaleFactor === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const safeScale = Math.max(scaleFactor, 1e-4)
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node
        const offsetX = node.position.x - center.x
        const offsetY = node.position.y - center.y
        const newX = center.x + offsetX * safeScale
        const newY = center.y + offsetY * safeScale
        const width = Math.max(node.size.width * safeScale, MIN_NODE_SIZE)
        const height = Math.max(node.size.height * safeScale, MIN_NODE_SIZE)
        return {
          ...node,
          position: { x: newX, y: newY },
          size: { width, height },
          shape: scaleShapeDefinition(node.shape, safeScale, width, height),
          stroke: node.stroke
            ? {
                ...node.stroke,
                width: Math.max(node.stroke.width * safeScale, 0),
              }
            : undefined,
        }
      })
      const shouldRecord = options?.record ?? false
      const history = shouldRecord && !prev.history.recording
        ? pushSnapshot(prev.history, createSnapshot(prev))
        : prev.history
      return { nodes, history }
    }),
  rotateSelected: (center, deltaRadians, options) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      if (!Number.isFinite(deltaRadians) || deltaRadians === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const cos = Math.cos(deltaRadians)
      const sin = Math.sin(deltaRadians)
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node
        const offsetX = node.position.x - center.x
        const offsetY = node.position.y - center.y
        const rotatedX = offsetX * cos - offsetY * sin
        const rotatedY = offsetX * sin + offsetY * cos
        return {
          ...node,
          position: {
            x: center.x + rotatedX,
            y: center.y + rotatedY,
          },
          rotation: normalizeAngle(node.rotation + deltaRadians),
          stroke: node.stroke ? { ...node.stroke } : undefined,
        }
      })
      const shouldRecord = options?.record ?? false
      const history = shouldRecord && !prev.history.recording
        ? pushSnapshot(prev.history, createSnapshot(prev))
        : prev.history
      return { nodes, history }
    }),
  updateSelectedFill: (color) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const nodes = prev.nodes.map((node) =>
        selectedSet.has(node.id)
          ? {
              ...node,
              fill: color,
            }
          : node,
      )
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return {
        nodes,
        history,
      }
    }),
  updateSelectedStroke: (stroke) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node
        const prevStroke = node.stroke ?? { color: DEFAULT_STROKE, width: 2 }
        const nextStroke = {
          color: stroke.color ?? prevStroke.color,
          width: Math.max(0, stroke.width ?? prevStroke.width ?? 0),
        }
        return {
          ...node,
          stroke: nextStroke,
        }
      })
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return {
        nodes,
        history,
      }
    }),
  updateSelectedCornerRadius: (cornerRadius) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const radius = Math.max(0, cornerRadius)
      const selectedSet = new Set(prev.selectedIds)
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node
        if (node.type !== 'shape' || node.shape?.kind !== 'rectangle') return node
        const maxRadius = Math.min(node.size.width, node.size.height) / 2
        return {
          ...node,
          shape: {
            kind: 'rectangle' as const,
            cornerRadius: Math.min(radius, maxRadius),
          },
        }
      })
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return {
        nodes,
        history,
      }
    }),
  lockSelected: () =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      const selectedSet = new Set(prev.selectedIds)
      const nodes = prev.nodes.map((node) =>
        selectedSet.has(node.id)
          ? {
              ...node,
              locked: true,
            }
          : node,
      )
      return {
        nodes,
        selectedIds: [],
        lastSelectedId: null,
        history,
      }
    }),
  unlockNodes: (ids) =>
    set((prev) => {
      if (ids.length === 0) return prev
      const unlockSet = new Set(ids)
      const nodes = prev.nodes.map((node) =>
        unlockSet.has(node.id)
          ? {
              ...node,
              locked: false,
            }
          : node,
      )
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return {
        nodes,
        history,
      }
    }),
  bringSelectedForward: () =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const nodes = [...prev.nodes]
      let moved = false
      for (let i = nodes.length - 2; i >= 0; i -= 1) {
        if (selectedSet.has(nodes[i].id) && !selectedSet.has(nodes[i + 1]?.id)) {
          ;[nodes[i], nodes[i + 1]] = [nodes[i + 1], nodes[i]]
          moved = true
        }
      }
      if (!moved) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  sendSelectedBackward: () =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const nodes = [...prev.nodes]
      let moved = false
      for (let i = 1; i < nodes.length; i += 1) {
        if (selectedSet.has(nodes[i].id) && !selectedSet.has(nodes[i - 1]?.id)) {
          ;[nodes[i], nodes[i - 1]] = [nodes[i - 1], nodes[i]]
          moved = true
        }
      }
      if (!moved) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  bringSelectedToFront: () =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const selectedNodes = prev.nodes.filter((node) => selectedSet.has(node.id))
      const others = prev.nodes.filter((node) => !selectedSet.has(node.id))
      const nodes = [...others, ...selectedNodes]
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  sendSelectedToBack: () =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const selectedNodes = prev.nodes.filter((node) => selectedSet.has(node.id))
      const others = prev.nodes.filter((node) => !selectedSet.has(node.id))
      const nodes = [...selectedNodes, ...others]
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  undo: () =>
    set((prev) => {
      if (prev.history.past.length === 0) return prev
      const snapshot = prev.history.past[prev.history.past.length - 1]
      const newPast = prev.history.past.slice(0, -1)
      const currentSnapshot = createSnapshot(prev)
      const future = [...prev.history.future, currentSnapshot]
      if (future.length > HISTORY_LIMIT) {
        future.shift()
      }
      return {
        nodes: cloneNodes(snapshot.nodes),
        selectedIds: [...snapshot.selectedIds],
        lastSelectedId: snapshot.selectedIds.at(-1) ?? null,
        world: cloneWorld(snapshot.world),
        history: {
          past: newPast,
          future,
          recording: false,
        },
      }
    }),
  redo: () =>
    set((prev) => {
      if (prev.history.future.length === 0) return prev
      const snapshot = prev.history.future[prev.history.future.length - 1]
      const newFuture = prev.history.future.slice(0, -1)
      const currentSnapshot = createSnapshot(prev)
      const past = [...prev.history.past, currentSnapshot]
      if (past.length > HISTORY_LIMIT) {
        past.shift()
      }
      return {
        nodes: cloneNodes(snapshot.nodes),
        selectedIds: [...snapshot.selectedIds],
        lastSelectedId: snapshot.selectedIds.at(-1) ?? null,
        world: cloneWorld(snapshot.world),
        history: {
          past,
          future: newFuture,
          recording: false,
        },
      }
    }),
  getWorldCenter: () => {
    const { viewport, world } = get()
    if (viewport.width === 0 || viewport.height === 0) {
      return { x: 0, y: 0 }
    }

    return screenToWorld(
      {
        x: viewport.width / 2,
        y: viewport.height / 2,
      },
      world,
    )
  },
}))

export function getNodeCorners(node: SceneNode): Vec2[] {
  const angle = node.rotation ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  if (node.shape?.kind === 'polygon' && node.shape.points.length >= 3) {
    return node.shape.points.map((point) => {
      const localX = point.x * node.size.width
      const localY = point.y * node.size.height
      return {
        x: node.position.x + localX * cos - localY * sin,
        y: node.position.y + localX * sin + localY * cos,
      }
    })
  }

  const halfWidth = node.size.width / 2
  const halfHeight = node.size.height / 2
  const corners: Vec2[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  return corners.map((corner) => ({
    x: node.position.x + corner.x * cos - corner.y * sin,
    y: node.position.y + corner.x * sin + corner.y * cos,
  }))
}

export function getNodeAABB(node: SceneNode): AABB {
  const corners = getNodeCorners(node)
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const corner of corners) {
    if (corner.x < minX) minX = corner.x
    if (corner.x > maxX) maxX = corner.x
    if (corner.y < minY) minY = corner.y
    if (corner.y > maxY) maxY = corner.y
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
  }
}

export function containsPoint(box: AABB, point: Vec2) {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY
}

export function intersectsAABB(a: AABB, b: AABB) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}

export function screenToWorld(point: Vec2, transform: WorldTransform): Vec2 {
  const scale = getSafeScale(transform.scale)
  return {
    x: (point.x - transform.position.x) / scale,
    y: (point.y - transform.position.y) / scale,
  }
}

export function worldToScreen(point: Vec2, transform: WorldTransform): Vec2 {
  const scale = getSafeScale(transform.scale)
  return {
    x: point.x * scale + transform.position.x,
    y: point.y * scale + transform.position.y,
  }
}

export function getCameraWorldCenter(viewport: Viewport, transform: WorldTransform): Vec2 {
  if (viewport.width === 0 || viewport.height === 0) {
    return { x: 0, y: 0 }
  }
  return screenToWorld({ x: viewport.width / 2, y: viewport.height / 2 }, transform)
}

export function normalizeAABB(a: AABB): AABB {
  const minX = Math.min(a.minX, a.maxX)
  const maxX = Math.max(a.minX, a.maxX)
  const minY = Math.min(a.minY, a.maxY)
  const maxY = Math.max(a.minY, a.maxY)
  return { minX, minY, maxX, maxY }
}

const MIN_SAFE_SCALE = 1e-9

function getSafeScale(scale: number) {
  if (scale === 0) return MIN_SAFE_SCALE
  if (Math.abs(scale) < MIN_SAFE_SCALE) {
    return scale < 0 ? -MIN_SAFE_SCALE : MIN_SAFE_SCALE
  }
  return scale
}

const TWO_PI = Math.PI * 2

function normalizeAngle(angle: number) {
  if (!Number.isFinite(angle)) return 0
  let result = angle % TWO_PI
  if (result > Math.PI) {
    result -= TWO_PI
  } else if (result < -Math.PI) {
    result += TWO_PI
  }
  return result
}
