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
      const nodes = [...prev.nodes, node]
      return {
        nodes,
        selectedIds: [id],
        lastSelectedId: id,
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
        position: transform.position ?? prev.world.position,
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

export function getNodeAABB(node: SceneNode): AABB {
  const halfWidth = node.size.width / 2
  const halfHeight = node.size.height / 2
  return {
    minX: node.position.x - halfWidth,
    minY: node.position.y - halfHeight,
    maxX: node.position.x + halfWidth,
    maxY: node.position.y + halfHeight,
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
