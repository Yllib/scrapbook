import { create } from 'zustand'
import {
  deriveSingleLevel,
  maxTileLevel as getMaxTileLevel,
  normalizeTileLevels,
  type TileLevelDefinition,
} from '../tiles/tileLevels'
import { normalizeFontRequest } from '../canvas/text/fontUtils'
import { getLoadedVectorFont, resolveVectorFontByDescriptor } from '../canvas/text/vectorFont'
import { layoutVectorText } from '../canvas/text/vectorTextLayout'

export type SceneNodeType = 'shape' | 'image' | 'text'
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
  image?: ImageDefinition
  text?: TextDefinition
  aspectRatioLocked: boolean
  fill?: string
  stroke?: {
    color: string
    width: number
  }
  locked: boolean
}

export interface ImageDefinition {
  assetId: string
  intrinsicSize: Size2D
  tileSize?: number
  grid?: {
    columns: number
    rows: number
  }
  tileLevels?: TileLevelDefinition[]
  maxTileLevel?: number
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

export interface TextDefinition {
  content: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  align: 'left' | 'center' | 'right'
  fontStyle: 'normal' | 'italic'
  underline: boolean
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
const DEFAULT_TILE_SIZE = 256
const DEFAULT_POLYGON_POINTS: Vec2[] = [
  { x: 0, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
]
export const DEFAULT_FONT_FAMILY = 'Inter, "Helvetica Neue", Arial, sans-serif'
export const DEFAULT_FONT_SIZE = 32
export const DEFAULT_FONT_WEIGHT = 400
export const DEFAULT_LINE_HEIGHT = 1.2
export const DEFAULT_TEXT_ALIGN: TextDefinition['align'] = 'left'
export const DEFAULT_TEXT_CONTENT = 'Text'
const DEFAULT_FONT_STYLE: TextDefinition['fontStyle'] = 'normal'
const TEXT_MEASURE_CANVAS = typeof document !== 'undefined' ? document.createElement('canvas') : null
const TEXT_MEASURE_CTX = TEXT_MEASURE_CANVAS ? TEXT_MEASURE_CANVAS.getContext('2d') : null

const measureTextSize = (text: TextDefinition): Size2D => {
  const descriptor = normalizeFontRequest({
    fontFamily: text.fontFamily,
    fontWeight: text.fontWeight,
    fontStyle: text.fontStyle,
    fontSize: text.fontSize,
  })

  const vectorFont = getLoadedVectorFont(descriptor)
  if (vectorFont) {
    const layout = layoutVectorText({
      text: text.content,
      font: vectorFont,
      fontSize: text.fontSize,
      lineHeight: text.lineHeight,
      align: text.align,
    })
    return {
      width: Math.max(32, layout.bounds.width),
      height: Math.max(32, layout.bounds.height),
    }
  }

  // Trigger async load for future measurements.
  resolveVectorFontByDescriptor(descriptor).catch(() => {})

  const lines = text.content.split(/\r?\n/)
  if (TEXT_MEASURE_CTX && TEXT_MEASURE_CANVAS) {
    TEXT_MEASURE_CTX.font = `${text.fontStyle} ${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`
    const widths = lines.map((line) => TEXT_MEASURE_CTX.measureText(line || ' ').width)
    const maxWidth = widths.length ? Math.max(...widths) : 0
    const height = Math.max(text.fontSize, lines.length * text.fontSize * text.lineHeight)
    return {
      width: Math.max(32, maxWidth),
      height: Math.max(32, height),
    }
  }
  const fallbackWidth = Math.max(
    32,
    lines.reduce((max, line) => Math.max(max, line.length * text.fontSize * 0.6), 0),
  )
  const fallbackHeight = Math.max(text.fontSize, lines.length * text.fontSize * text.lineHeight)
  return { width: fallbackWidth, height: fallbackHeight }
}

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
  showGrid: boolean
  showOrigin: boolean
  backgroundColor: string
  createRectangleNode: (overrides?: Partial<Omit<SceneNode, 'type'>>) => SceneNode
  createShapeNode: (shape: ShapeDefinition, overrides?: Partial<Omit<SceneNode, 'type' | 'shape'>>) => SceneNode
  createImageNode: (
    image: ImageDefinition,
    overrides?: Partial<Omit<SceneNode, 'type' | 'image' | 'shape'>>, // images ignore shape overrides
  ) => SceneNode
  createTextNode: (
    overrides?: Partial<Omit<SceneNode, 'type' | 'text' | 'image' | 'shape'>> & { text?: Partial<TextDefinition> },
  ) => SceneNode
  deleteNodes: (ids: string[]) => void
  renameNode: (id: string, name: string) => void
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
  scaleSelected: (center: Vec2, scaleX: number, scaleY: number, options?: { record?: boolean }) => void
  rotateSelected: (center: Vec2, deltaRadians: number, options?: { record?: boolean }) => void
  updateSelectedFill: (color: string) => void
  updateSelectedStroke: (stroke: Partial<{ color: string; width: number }>) => void
  updateSelectedCornerRadius: (cornerRadius: number) => void
  setSelectedAspectRatioLocked: (locked: boolean) => void
  updateSelectedTextContent: (content: string) => void
  setSelectedFontFamily: (fontFamily: string) => void
  setSelectedFontSize: (fontSize: number) => void
  setSelectedTextAlign: (align: TextDefinition['align']) => void
  setSelectedLineHeight: (lineHeight: number) => void
  setSelectedFontWeight: (fontWeight: number) => void
  setSelectedFontStyle: (style: TextDefinition['fontStyle']) => void
  setSelectedUnderline: (underline: boolean) => void
  lockSelected: () => void
  unlockNodes: (ids: string[]) => void
  bringSelectedForward: () => void
  sendSelectedBackward: () => void
  bringSelectedToFront: () => void
  sendSelectedToBack: () => void
  undo: () => void
  redo: () => void
  history: HistoryState
  setShowGrid: (visible: boolean) => void
  setShowOrigin: (visible: boolean) => void
  setBackgroundColor: (color: string) => void
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
  image: node.image
    ? {
        assetId: node.image.assetId,
        intrinsicSize: { ...node.image.intrinsicSize },
        tileSize: node.image.tileSize,
        grid: node.image.grid ? { ...node.image.grid } : undefined,
        tileLevels: node.image.tileLevels ? node.image.tileLevels.map((level) => ({ ...level })) : undefined,
        maxTileLevel: node.image.maxTileLevel,
      }
    : undefined,
  text: node.text
    ? {
        content: node.text.content,
        fontFamily: node.text.fontFamily,
        fontSize: node.text.fontSize,
        fontWeight: node.text.fontWeight,
        lineHeight: node.text.lineHeight,
        align: node.text.align,
        fontStyle: node.text.fontStyle,
        underline: node.text.underline,
      }
    : undefined,
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
  showGrid: true,
  showOrigin: true,
  backgroundColor: '#020617',
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
        aspectRatioLocked: overrides.aspectRatioLocked,
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
      aspectRatioLocked: overrides.aspectRatioLocked ?? true,
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
  createImageNode: (image, overrides = {}) => {
    const id = overrides.id ?? crypto.randomUUID()
    const state = get()
    const center = overrides.position ?? state.getWorldCenter()
    const scale = state.world.scale || 1
    const factor = 1 / scale
    const intrinsic = {
      width: image.intrinsicSize?.width ?? DEFAULT_RECT_SIZE.width,
      height: image.intrinsicSize?.height ?? DEFAULT_RECT_SIZE.height,
    }
    const tileSize = image.tileSize ?? DEFAULT_TILE_SIZE
    const normalizedTileLevels = normalizeTileLevels(
      image.tileLevels ?? deriveSingleLevel(intrinsic.width, intrinsic.height, tileSize),
    )
    const zeroLevel = normalizedTileLevels.find((level) => level.z === 0)
    const grid =
      image.grid ??
      (zeroLevel
        ? { columns: zeroLevel.columns, rows: zeroLevel.rows }
        : {
            columns: Math.max(1, Math.ceil(intrinsic.width / tileSize)),
            rows: Math.max(1, Math.ceil(intrinsic.height / tileSize)),
          })
    const maxTileLevel = image.maxTileLevel ?? getMaxTileLevel(normalizedTileLevels)
    const size = overrides.size ?? {
      width: intrinsic.width * factor,
      height: intrinsic.height * factor,
    }

    const node: SceneNode = {
      id,
      type: 'image',
      name: overrides.name ?? `Image ${state.nodes.length + 1}`,
      position: { x: center.x, y: center.y },
      size: { width: size.width, height: size.height },
      rotation: overrides.rotation ?? 0,
      image: {
        assetId: image.assetId,
        intrinsicSize: { ...intrinsic },
        tileSize,
        grid,
        tileLevels: normalizedTileLevels,
        maxTileLevel,
      },
      fill: overrides.fill,
      stroke: overrides.stroke,
      locked: overrides.locked ?? false,
      aspectRatioLocked: overrides.aspectRatioLocked ?? true,
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
  createTextNode: (overrides = {}) => {
    const id = overrides.id ?? crypto.randomUUID()
    const state = get()
    const center = overrides.position ?? state.getWorldCenter()
    const textDef: TextDefinition = {
      content: overrides.text?.content ?? DEFAULT_TEXT_CONTENT,
      fontFamily: overrides.text?.fontFamily ?? DEFAULT_FONT_FAMILY,
      fontSize: overrides.text?.fontSize ?? DEFAULT_FONT_SIZE,
      fontWeight: overrides.text?.fontWeight ?? DEFAULT_FONT_WEIGHT,
      lineHeight: overrides.text?.lineHeight ?? DEFAULT_LINE_HEIGHT,
      align: overrides.text?.align ?? DEFAULT_TEXT_ALIGN,
      fontStyle: overrides.text?.fontStyle ?? DEFAULT_FONT_STYLE,
      underline: overrides.text?.underline ?? false,
    }
    const size = overrides.size ?? measureTextSize(textDef)
    const node: SceneNode = {
      id,
      type: 'text',
      name: overrides.name ?? `Text ${state.nodes.length + 1}`,
      position: { x: center.x, y: center.y },
      size: { width: size.width, height: size.height },
      rotation: overrides.rotation ?? 0,
      text: textDef,
      fill: overrides.fill ?? DEFAULT_FILL,
      stroke: overrides.stroke,
      locked: overrides.locked ?? false,
      aspectRatioLocked: overrides.aspectRatioLocked ?? false,
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
  renameNode: (id, name) => {
    set((prev) => {
      const trimmed = name.trim()
      if (!trimmed) return prev
      const hasNode = prev.nodes.some((node) => node.id === id)
      if (!hasNode) return prev
      const nodes = prev.nodes.map((node) => (node.id === id ? { ...node, name: trimmed } : node))
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
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
  scaleSelected: (center, scaleX, scaleY, options) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY)) return prev
      const selectedSet = new Set(prev.selectedIds)
      const safeScaleX = Math.max(scaleX, 1e-4)
      const safeScaleY = Math.max(scaleY, 1e-4)
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node
        const offsetX = node.position.x - center.x
        const offsetY = node.position.y - center.y
        const minScaleX = MIN_NODE_SIZE / Math.max(node.size.width, Number.EPSILON)
        const minScaleY = MIN_NODE_SIZE / Math.max(node.size.height, Number.EPSILON)

        let effectiveScaleX = Math.max(safeScaleX, minScaleX)
        let effectiveScaleY = Math.max(safeScaleY, minScaleY)

        if (node.aspectRatioLocked) {
          const uniformScale = Math.max(effectiveScaleX, effectiveScaleY)
          effectiveScaleX = uniformScale
          effectiveScaleY = uniformScale
        }

        const newX = center.x + offsetX * effectiveScaleX
        const newY = center.y + offsetY * effectiveScaleY
        const width = node.size.width * effectiveScaleX
        const height = node.size.height * effectiveScaleY
        const areaScale = Math.max(effectiveScaleX * effectiveScaleY, 1e-8)
        const shapeScale = Math.sqrt(areaScale)

        if (node.type === 'text' && node.text) {
          const uniformScale = Math.max(effectiveScaleX, effectiveScaleY)
          const nextFontSize = Math.max(4, node.text.fontSize * uniformScale)
          const text = { ...node.text, fontSize: nextFontSize }
          const size = measureTextSize(text)
          return {
            ...node,
            position: { x: newX, y: newY },
            size,
            text,
          }
        }

        return {
          ...node,
          position: { x: newX, y: newY },
          size: { width, height },
          shape: scaleShapeDefinition(node.shape, shapeScale, width, height),
          stroke: node.stroke
            ? {
                ...node.stroke,
                width: Math.max(node.stroke.width * shapeScale, 0),
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
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id)) return node
        if (node.type !== 'shape') return node
        return {
          ...node,
          fill: color,
        }
      })
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
        if (node.type !== 'shape') return node
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
  setSelectedAspectRatioLocked: (locked) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      const nodes = prev.nodes.map((node) =>
        selectedSet.has(node.id) ? { ...node, aspectRatioLocked: locked } : node,
      )
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return {
        nodes,
        history,
      }
    }),
  updateSelectedTextContent: (content) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const normalized = content ?? ''
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.content === normalized) return node
        changed = true
        const text = { ...node.text, content: normalized }
        const size = measureTextSize(text)
        return {
          ...node,
          text,
          size,
        }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedFontFamily: (fontFamily) =>
    set((prev) => {
      if (!fontFamily || prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.fontFamily === fontFamily) return node
        changed = true
        const text = { ...node.text, fontFamily }
        const size = measureTextSize(text)
        return { ...node, text, size }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedFontSize: (fontSize) =>
    set((prev) => {
      if (!Number.isFinite(fontSize) || fontSize <= 0 || prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.fontSize === fontSize) return node
        changed = true
        const text = { ...node.text, fontSize }
        const size = measureTextSize(text)
        return { ...node, text, size }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedTextAlign: (align) =>
    set((prev) => {
      if (!align || prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.align === align) return node
        changed = true
        return {
          ...node,
          text: { ...node.text, align },
        }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedFontWeight: (fontWeight) =>
    set((prev) => {
      if (!Number.isFinite(fontWeight) || prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.fontWeight === fontWeight) return node
        changed = true
        const text = { ...node.text, fontWeight }
        const size = measureTextSize(text)
        return { ...node, text, size }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedFontStyle: (style) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.fontStyle === style) return node
        changed = true
        const text = { ...node.text, fontStyle: style }
        const size = measureTextSize(text)
        return { ...node, text, size }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedUnderline: (underline) =>
    set((prev) => {
      if (prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.underline === underline) return node
        changed = true
        return { ...node, text: { ...node.text, underline } }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
    }),
  setSelectedLineHeight: (lineHeight) =>
    set((prev) => {
      if (!Number.isFinite(lineHeight) || lineHeight <= 0 || prev.selectedIds.length === 0) return prev
      const selectedSet = new Set(prev.selectedIds)
      let changed = false
      const nodes = prev.nodes.map((node) => {
        if (!selectedSet.has(node.id) || node.type !== 'text' || !node.text) return node
        if (node.text.lineHeight === lineHeight) return node
        changed = true
        const text = { ...node.text, lineHeight }
        const size = measureTextSize(text)
        return { ...node, text, size }
      })
      if (!changed) return prev
      const history = !prev.history.recording ? pushSnapshot(prev.history, createSnapshot(prev)) : prev.history
      return { nodes, history }
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
  setShowGrid: (visible) =>
    set((prev) => {
      if (prev.showGrid === visible) return prev
      return { ...prev, showGrid: visible }
    }),
  setShowOrigin: (visible) =>
    set((prev) => {
      if (prev.showOrigin === visible) return prev
      return { ...prev, showOrigin: visible }
    }),
  setBackgroundColor: (color) =>
    set((prev) => {
      const trimmed = color?.trim()
      if (!trimmed) return prev
      if (prev.backgroundColor === trimmed) return prev
      return { ...prev, backgroundColor: trimmed }
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
