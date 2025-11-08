import { create } from 'zustand'

export type SceneNodeType = 'rectangle'

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

const cloneNode = (node: SceneNode): SceneNode => ({
  ...node,
  position: { ...node.position },
  size: { ...node.size },
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
    const id = overrides.id ?? crypto.randomUUID()
    const state = get()
    const center = overrides.position ?? state.getWorldCenter()
    const size = overrides.size ?? DEFAULT_RECT_SIZE
    const node: SceneNode = {
      id,
      type: 'rectangle',
      name: overrides.name ?? `Rectangle ${state.nodes.length + 1}`,
      position: { x: center.x, y: center.y },
      size: { width: size.width, height: size.height },
      rotation: overrides.rotation ?? 0,
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
      const selectedIds = clampSelectionToNodes(ids, prev.nodes)
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

      const nodeExists = prev.nodes.some((node) => node.id === id)
      if (!nodeExists) return {}

      return {
        selectedIds: [...prev.selectedIds, id],
        lastSelectedId: id,
      }
    }),
  marqueeSelect: (box, additive) =>
    set((prev) => {
      const intersecting = prev.nodes
        .filter((node) => intersectsAABB(box, getNodeAABB(node)))
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
        }
      })
      const shouldRecord = options?.record ?? false
      const history = shouldRecord && !prev.history.recording
        ? pushSnapshot(prev.history, createSnapshot(prev))
        : prev.history
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
  const halfWidth = node.size.width / 2
  const halfHeight = node.size.height / 2
  const corners: Vec2[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  const angle = node.rotation ?? 0
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
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
