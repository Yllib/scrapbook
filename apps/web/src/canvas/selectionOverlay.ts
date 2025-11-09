import type { SceneNode, Vec2 } from '../state/scene'
import { getNodeCorners } from '../state/scene'

export interface SelectionOverlayGeometry {
  center: Vec2
  width: number
  height: number
  corners: Vec2[]
  edges: Vec2[]
  rotationHandle: Vec2
  rotation: number
}

export interface SelectionHandleSizing {
  strokeWidth: number
  cornerRadius: number
  edgeRadius: number
  rotationRadius: number
}

const ROTATION_HANDLE_OFFSET = 40
const BASE_HANDLE_SIZE = 6
const BASE_STROKE_SIZE = 1.5

const rotateVector = (point: Vec2, angle: number): Vec2 => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

const TAU = Math.PI * 2

function calculateSelectionRotation(nodes: SceneNode[]): number {
  if (nodes.length === 0) return 0
  let sinSum = 0
  let cosSum = 0
  for (const node of nodes) {
    const angle = node.rotation ?? 0
    sinSum += Math.sin(angle)
    cosSum += Math.cos(angle)
  }
  if (Math.abs(sinSum) < 1e-6 && Math.abs(cosSum) < 1e-6) return 0
  let result = Math.atan2(sinSum, cosSum)
  if (result > Math.PI) {
    result -= TAU
  } else if (result < -Math.PI) {
    result += TAU
  }
  return result
}

export function calculateGroupSelectionOverlay(nodes: SceneNode[]): SelectionOverlayGeometry | null {
  if (nodes.length === 0) return null

  const rotation = calculateSelectionRotation(nodes)
  const rotatedPoints = nodes.flatMap((node) =>
    getNodeCorners(node).map((corner) => rotateVector(corner, -rotation)),
  )

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of rotatedPoints) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  const width = Math.max(maxX - minX, Number.EPSILON)
  const height = Math.max(maxY - minY, Number.EPSILON)
  const halfWidth = width / 2
  const halfHeight = height / 2
  const centerLocal: Vec2 = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  }
  const center = rotateVector(centerLocal, rotation)

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
    rotation,
  }
}

export function calculateSelectionHandleSizing(worldScale: number): SelectionHandleSizing {
  const safeScale = Math.abs(worldScale) < Number.EPSILON ? Number.EPSILON : Math.abs(worldScale)
  const strokeWidth = BASE_STROKE_SIZE / safeScale
  const cornerRadius = BASE_HANDLE_SIZE / safeScale
  const edgeRadius = (BASE_HANDLE_SIZE * 0.75) / safeScale
  const rotationRadius = BASE_HANDLE_SIZE / safeScale
  return {
    strokeWidth,
    cornerRadius,
    edgeRadius,
    rotationRadius,
  }
}
