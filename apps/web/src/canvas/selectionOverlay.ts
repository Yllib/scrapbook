import type { SceneNode, Vec2 } from '../state/scene'
import { getNodeAABB } from '../state/scene'

export interface SelectionOverlayGeometry {
  center: Vec2
  width: number
  height: number
  corners: Vec2[]
  edges: Vec2[]
  rotationHandle: Vec2
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
}

export interface SelectionHandleSizing {
  strokeWidth: number
  cornerRadius: number
  edgeRadius: number
  rotationRadius: number
}

const ROTATION_HANDLE_OFFSET = 40

export function calculateGroupSelectionOverlay(nodes: SceneNode[]): SelectionOverlayGeometry | null {
  if (nodes.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    const bounds = getNodeAABB(node)
    minX = Math.min(minX, bounds.minX)
    minY = Math.min(minY, bounds.minY)
    maxX = Math.max(maxX, bounds.maxX)
    maxY = Math.max(maxY, bounds.maxY)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  const width = Math.max(maxX - minX, Number.EPSILON)
  const height = Math.max(maxY - minY, Number.EPSILON)
  const center: Vec2 = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }

  const halfWidth = width / 2
  const halfHeight = height / 2

  const corners: Vec2[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]

  const edges: Vec2[] = [
    { x: 0, y: -halfHeight },
    { x: halfWidth, y: 0 },
    { x: 0, y: halfHeight },
    { x: -halfWidth, y: 0 },
  ]

  const maxDimension = Math.max(width, height)
  const rotationHandleOffset = Math.max(ROTATION_HANDLE_OFFSET, maxDimension * 0.1)
  const rotationHandle: Vec2 = {
    x: 0,
    y: -halfHeight - rotationHandleOffset,
  }

  return {
    center,
    width,
    height,
    corners,
    edges,
    rotationHandle,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
    },
  }
}

export function calculateSelectionHandleSizing(worldScale: number): SelectionHandleSizing {
  const safeScale = Math.abs(worldScale) < Number.EPSILON ? Number.EPSILON : Math.abs(worldScale)
  const strokeWidth = Math.max(1.5, 1.5 / safeScale)
  const cornerRadius = Math.max(6, 6 / safeScale)
  const edgeRadius = cornerRadius * 0.75
  const rotationRadius = cornerRadius
  return {
    strokeWidth,
    cornerRadius,
    edgeRadius,
    rotationRadius,
  }
}
