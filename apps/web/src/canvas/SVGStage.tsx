import { useEffect, useRef, useState } from 'react'
import { ZoomBadge } from '../ui/ZoomBadge'
import { useSceneStore, type Vec2, type SceneNode, DEFAULT_POLYGON_POINTS } from '../state/scene'
import { requestConfirmation } from '../state/dialog'
// import { pickTileLevel } from '../tiles/tileLevels'
import { API_BASE } from '../api/client'
import { VIEWPORT_CONFIG } from './viewport/zoomLimits'
import { ZOOM_EVENT } from './events'
import {
  calculateGroupSelectionOverlay,
  calculateSelectionHandleSizing,
  type SelectionOverlayGeometry,
} from './selectionOverlay'

type HandleHit =
  | { kind: 'corner'; position: Vec2 }
  | { kind: 'edge'; position: Vec2; axis: 'x' | 'y' }
  | { kind: 'rotate'; position: Vec2 }

const WHEEL_ZOOM_SENSITIVITY = 0.0015
const PINCH_ZOOM_SENSITIVITY = 0.01
const GRID_MAJOR_BASE = 256
const GRID_MIN_SCREEN_SPACING = 24
const MAX_GRID_LINES = 64
const SVG_NS = 'http://www.w3.org/2000/svg'
const GRID_COLOR_MICRO = '#1e293b'
const GRID_COLOR_MINOR = '#273449'
const GRID_COLOR_MAJOR = '#0f172a'
const GRID_COLOR_AXIS = '#2563eb'
const ORIGIN_CROSS_COLOR = '#38bdf8'
const ORIGIN_RING_COLOR = '#0ea5e9'
const ORIGIN_FILL_COLOR = '#1d4ed8'
const ORIGIN_DOT_RADIUS = 6
const ORIGIN_ARM_LENGTH = 32
const ORIGIN_RING_WIDTH = 3
const ORIGIN_CROSS_WIDTH = 2
const DEFAULT_SHAPE_FILL = '#38bdf8'
const DEFAULT_SHAPE_STROKE = '#0ea5e9'
const SELECTION_OUTLINE_COLOR = '#ffffff'
const SELECTION_CORNER_COLOR = '#38bdf8'
const SELECTION_EDGE_COLOR = '#0ea5e9'
const SELECTION_ROTATION_COLOR = '#ffffff'
const MARQUEE_FILL_COLOR = '#38bdf8'
const MARQUEE_FILL_OPACITY = 0.15
const MARQUEE_STROKE_COLOR = '#0ea5e9'
const HANDLE_HIT_PADDING = 2
const HANDLE_HIT_MIN_PX = 18
const MIN_TEXT_DOM_FONT_SIZE = 1
const MAX_TEXT_DOM_FONT_SIZE = 4096
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const FALLBACK_TILE_SIZE = 256
const prefetchedTiles = new Set<string>()

const cachesAvailable = typeof window !== 'undefined' && typeof caches !== 'undefined'

const prefetchTile = async (assetId: string, level: number, x: number, y: number) => {
  const url = buildTileUrl(assetId, level, x, y)
  if (prefetchedTiles.has(url)) return
  prefetchedTiles.add(url)
  if (!cachesAvailable) {
    void fetch(url, { mode: 'same-origin', cache: 'force-cache' }).catch(() => {})
    return
  }
  try {
    const cache = await caches.open('tiles-v1')
    const match = await cache.match(url)
    if (match) return
    const res = await fetch(url, { mode: 'same-origin', cache: 'no-store' })
    if (res.ok) {
      await cache.put(url, res.clone())
    }
  } catch (err) {
    console.warn('tile prefetch failed', err)
  }
}

const rotateVector = (point: Vec2, angle: number): Vec2 => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

const toWorld = (overlay: SelectionOverlayGeometry, local: Vec2): Vec2 => {
  const rotated = rotateVector(local, overlay.rotation)
  return {
    x: overlay.center.x + rotated.x,
    y: overlay.center.y + rotated.y,
  }
}

const toLocal = (overlay: SelectionOverlayGeometry, worldPoint: Vec2): Vec2 => {
  const rel = {
    x: worldPoint.x - overlay.center.x,
    y: worldPoint.y - overlay.center.y,
  }
  return rotateVector(rel, -overlay.rotation)
}

const isPointInsideOverlay = (overlay: SelectionOverlayGeometry, worldPoint: Vec2) => {
  const local = toLocal(overlay, worldPoint)
  return Math.abs(local.x) <= overlay.width / 2 && Math.abs(local.y) <= overlay.height / 2
}

const createSvgElement = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS(SVG_NS, tag)

const getSafeDimension = (value: number, fallback = 1) =>
  Number.isFinite(value) && value > 0 ? value : fallback

const buildTileUrl = (assetId: string, level: number, x: number, y: number) =>
  `${API_BASE}/tiles/${assetId}/${level}/${x}/${y}.webp`

const buildSvgUrl = (assetId: string) => `${API_BASE}/assets/${assetId}/svg`

const svgCache = new Map<
  string,
  {
    fragment: DocumentFragment
    viewBox: { minX: number; minY: number; width: number; height: number } | null
    width: number
    height: number
  }
>()

const svgFetches = new Map<string, Promise<void>>()

const sanitizeSvg = (raw: string) => {
  // Strip scripts and inline event handlers; keep markup otherwise intact
  const withoutScripts = raw.replace(/<\s*script[\s\S]*?<\s*\/script\s*>/gi, '')
  const withoutEvents = withoutScripts.replace(/on[a-z]+\s*=\s*"[^"]*"/gi, '')
  return withoutEvents
}

const parseSvg = (assetId: string, svgText: string) => {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) return null
    const viewBoxAttr = svgEl.getAttribute('viewBox')
    let viewBox: { minX: number; minY: number; width: number; height: number } | null = null
    if (viewBoxAttr) {
      const parts = viewBoxAttr.split(/\s+/).map((v) => Number.parseFloat(v))
      if (parts.length === 4 && parts.every((v) => Number.isFinite(v))) {
        viewBox = { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] }
      }
    }
    const widthAttr = Number.parseFloat(svgEl.getAttribute('width') ?? '')
    const heightAttr = Number.parseFloat(svgEl.getAttribute('height') ?? '')
    const sourceWidth = Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : viewBox?.width ?? 1
    const sourceHeight = Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : viewBox?.height ?? 1
    const fragment = document.createDocumentFragment()
    svgEl.childNodes.forEach((node) => {
      fragment.appendChild(node.cloneNode(true))
    })
    svgCache.set(assetId, { fragment, viewBox, width: sourceWidth, height: sourceHeight })
    return svgCache.get(assetId) ?? null
  } catch (error) {
    console.warn('Failed to parse SVG', error)
    return null
  }
}

const ensureSvgCached = (assetId: string, onReady: () => void) => {
  if (svgCache.has(assetId)) return Promise.resolve()
  const existing = svgFetches.get(assetId)
  if (existing) return existing
  const fetchPromise = fetch(buildSvgUrl(assetId), { mode: 'same-origin', cache: 'force-cache' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`SVG fetch failed: ${res.status}`)
      const text = await res.text()
      const sanitized = sanitizeSvg(text)
      parseSvg(assetId, sanitized)
    })
    .catch((error) => {
      console.warn('SVG fetch/parse failed', error)
    })
    .finally(() => {
      svgFetches.delete(assetId)
      onReady()
    })
  svgFetches.set(assetId, fetchPromise)
  return fetchPromise
}

const getTileLevelStats = (node: SceneNode, level: number) => {
  const image = node.image
  const tileSize = Math.max(1, image?.tileSize ?? FALLBACK_TILE_SIZE)
  const safeLevel = Math.max(0, Math.floor(level))
  const intrinsicWidth = getSafeDimension(image?.intrinsicSize.width ?? node.size.width)
  const intrinsicHeight = getSafeDimension(image?.intrinsicSize.height ?? node.size.height)
  const scaleFactor = 2 ** safeLevel
  const levelWidth = Math.max(1, Math.ceil(intrinsicWidth / scaleFactor))
  const levelHeight = Math.max(1, Math.ceil(intrinsicHeight / scaleFactor))
  const levelEntry = image?.tileLevels?.find((entry) => entry.z === safeLevel)
  const columns = Math.max(1, levelEntry?.columns ?? Math.ceil(levelWidth / tileSize))
  const rows = Math.max(1, levelEntry?.rows ?? Math.ceil(levelHeight / tileSize))
  return {
    tileSize,
    levelWidth,
    levelHeight,
    columns,
    rows,
    level: safeLevel,
  }
}

// Hardcode to highest-detail tiles for now; revisit level picking after sizing bug is resolved
// const getImageDensity = (node: SceneNode, scale: number) => {
//   const intrinsicWidth = getSafeDimension(node.image?.intrinsicSize.width ?? node.size.width)
//   const intrinsicHeight = getSafeDimension(node.image?.intrinsicSize.height ?? node.size.height)
//   const widthDensity = (getSafeDimension(node.size.width) * scale) / intrinsicWidth
//   const heightDensity = (getSafeDimension(node.size.height) * scale) / intrinsicHeight
//   const density = Math.max(widthDensity, heightDensity)
//   return Number.isFinite(density) && density > 0 ? density : 1
// }


export function SVGStage() {
  const storeApi = useSceneStore
  const hostRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: { id: string; name: string }[] } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const svg = svgRef.current
    if (!host || !svg) return

    let disposed = false
    let hostBounds = host.getBoundingClientRect()

    const gridGroup = createSvgElement('g')
    gridGroup.classList.add('svg-stage__grid')

    const nodesGroup = createSvgElement('g')
    nodesGroup.classList.add('svg-stage__nodes')

    const marqueeGroup = createSvgElement('g')
    marqueeGroup.classList.add('svg-stage__marquee')

    const selectionGroup = createSvgElement('g')
    selectionGroup.classList.add('svg-stage__selection')

    const originGroup = createSvgElement('g')
    originGroup.classList.add('svg-stage__origin')
    const originCrossX = createSvgElement('line')
    const originCrossY = createSvgElement('line')
    const originCircle = createSvgElement('circle')
    originCircle.setAttribute('cx', '0')
    originCircle.setAttribute('cy', '0')
    originCrossX.setAttribute('stroke-linecap', 'round')
    originCrossY.setAttribute('stroke-linecap', 'round')
    originGroup.append(originCrossX, originCrossY, originCircle)

    svg.append(gridGroup, nodesGroup, marqueeGroup, selectionGroup, originGroup)

    const clampScale = (value: number) =>
      Math.min(VIEWPORT_CONFIG.maxZoom, Math.max(VIEWPORT_CONFIG.minZoom, Number.isFinite(value) ? value : 1))

    const clearChildren = (element: Element) => {
      while (element.firstChild) {
        element.removeChild(element.firstChild)
      }
    }

    const getViewportSize = () => {
      const width = host.clientWidth || hostBounds.width || 0
      const height = host.clientHeight || hostBounds.height || 0
      return { width, height }
    }

    const refreshHostBounds = () => {
      hostBounds = host.getBoundingClientRect()
    }

    const getHostPoint = (event: PointerEvent | WheelEvent): Vec2 => ({
      x: event.clientX - hostBounds.left,
      y: event.clientY - hostBounds.top,
    })

    host.style.touchAction = 'none'
    host.style.userSelect = 'none'
    host.style.cursor = 'default'
    svg.style.transformOrigin = '0 0'
    svg.setAttribute('overflow', 'visible')

    let gridVisible = storeApi.getState().showGrid
    let originVisible = storeApi.getState().showOrigin

    const getFillColor = (node: SceneNode) => node.fill?.trim() || DEFAULT_SHAPE_FILL
    const getStrokeColor = (node: SceneNode) => node.stroke?.color?.trim() || DEFAULT_SHAPE_STROKE

    const createShapeElement = (node: SceneNode): SVGElement | null => {
      if (node.type !== 'shape') return null
      const shape = node.shape ?? { kind: 'rectangle', cornerRadius: 0 }
      const width = node.size.width
      const height = node.size.height
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return null
      }

      const fillColor = getFillColor(node)
      const strokeColor = getStrokeColor(node)
      const strokeWidth = node.stroke?.width ?? 0

      if (shape.kind === 'ellipse') {
        const ellipse = createSvgElement('ellipse')
        ellipse.setAttribute('cx', '0')
        ellipse.setAttribute('cy', '0')
        ellipse.setAttribute('rx', (width / 2).toString())
        ellipse.setAttribute('ry', (height / 2).toString())
        ellipse.setAttribute('fill', fillColor)
        if (strokeWidth > 0) {
          ellipse.setAttribute('stroke', strokeColor)
          ellipse.setAttribute('stroke-width', strokeWidth.toString())
        } else {
          ellipse.setAttribute('stroke', 'none')
        }
        return ellipse
      }

      if (shape.kind === 'polygon') {
        const points = (shape.points?.length ? shape.points : DEFAULT_POLYGON_POINTS).map((point) => ({
          x: point.x * width,
          y: point.y * height,
        }))
        const polygon = createSvgElement('polygon')
        polygon.setAttribute('points', points.map((point) => `${point.x} ${point.y}`).join(' '))
        polygon.setAttribute('fill', fillColor)
        if (strokeWidth > 0) {
          polygon.setAttribute('stroke', strokeColor)
          polygon.setAttribute('stroke-width', strokeWidth.toString())
        } else {
          polygon.setAttribute('stroke', 'none')
        }
        polygon.setAttribute('fill-rule', 'evenodd')
        return polygon
      }

      const rect = createSvgElement('rect')
      const radius = Math.max(0, Math.min(shape.cornerRadius ?? 0, Math.min(width, height) / 2))
      rect.setAttribute('x', (-width / 2).toString())
      rect.setAttribute('y', (-height / 2).toString())
      rect.setAttribute('width', width.toString())
      rect.setAttribute('height', height.toString())
      if (radius > 0) {
        rect.setAttribute('rx', radius.toString())
        rect.setAttribute('ry', radius.toString())
      }
      rect.setAttribute('fill', fillColor)
      if (strokeWidth > 0) {
        rect.setAttribute('stroke', strokeColor)
        rect.setAttribute('stroke-width', strokeWidth.toString())
      } else {
        rect.setAttribute('stroke', 'none')
      }
      return rect
    }

    const createImageElement = (node: SceneNode): SVGElement | null => {
      if (node.type !== 'image' || !node.image) {
        return null
      }
      const assetId = node.image.assetId?.trim()
      if (!assetId) {
        return null
      }
      const width = getSafeDimension(node.size.width)
      const height = getSafeDimension(node.size.height)

      if (node.image.isSvg) {
        const cached = svgCache.get(assetId)
        if (!cached) {
          void ensureSvgCached(assetId, () => {
            if (disposed) return
            renderScene(lastNodes, selectedIds)
          })
          return null
        }
        const sourceWidth = getSafeDimension(cached.viewBox?.width ?? cached.width)
        const sourceHeight = getSafeDimension(cached.viewBox?.height ?? cached.height)
        const scaleX = sourceWidth > 0 ? width / sourceWidth : 1
        const scaleY = sourceHeight > 0 ? height / sourceHeight : 1
        const group = createSvgElement('g')
        group.classList.add('svg-stage__image', 'svg-stage__image--svg')

        // Position SVG so that its top-left aligns with the node's top-left (node is centered at origin)
        const container = createSvgElement('g')
        container.setAttribute('transform', `translate(${-width / 2} ${-height / 2})`)

        const content = createSvgElement('g')
        const translateX = cached.viewBox ? -cached.viewBox.minX : 0
        const translateY = cached.viewBox ? -cached.viewBox.minY : 0
        content.setAttribute('transform', `translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})`)
        content.appendChild(cached.fragment.cloneNode(true))

        container.appendChild(content)
        group.appendChild(container)
        return group
      }

      const group = createSvgElement('g')
      group.classList.add('svg-stage__image')
      // Stick to highest-detail tiles for now to avoid LOD mismatches
      const level = 0
      const stats = getTileLevelStats(node, level)
      const childStats = level > 0 ? getTileLevelStats(node, level - 1) : null
      const parentStats = level < (node.image?.maxTileLevel ?? 0) ? getTileLevelStats(node, level + 1) : null
      group.dataset.tileLevel = level.toString()
      const halfWidth = width / 2
      const halfHeight = height / 2

      let topPx = 0
      let y = 0
      while (topPx < stats.levelHeight) {
        const tileHeightPx = Math.min(stats.tileSize, stats.levelHeight - topPx)
        if (tileHeightPx <= 0) break
        let leftPx = 0
        let x = 0
      while (leftPx < stats.levelWidth) {
        const tileWidthPx = Math.min(stats.tileSize, stats.levelWidth - leftPx)
        if (tileWidthPx <= 0) break
          const normalizedLeft = leftPx / stats.levelWidth
          const normalizedTop = topPx / stats.levelHeight
          // Size tiles by their actual content, not the nominal tileSize, to avoid stretching padded edges
          const normalizedWidth = tileWidthPx / stats.levelWidth
          const normalizedHeight = tileHeightPx / stats.levelHeight
          // Slightly overlap neighbors (≈0.5 screen px) to hide any remaining subpixel seams
          const overlapWorld = 0.5 / Math.max(scale, Number.EPSILON)
          const expandX = overlapWorld * 2
          const expandY = overlapWorld * 2
          const tileElement = createSvgElement('image')
          tileElement.setAttribute('x', (-halfWidth + normalizedLeft * width - overlapWorld).toString())
          tileElement.setAttribute('y', (-halfHeight + normalizedTop * height - overlapWorld).toString())
          tileElement.setAttribute('width', (normalizedWidth * width + expandX).toString())
          tileElement.setAttribute('height', (normalizedHeight * height + expandY).toString())
          tileElement.setAttribute('preserveAspectRatio', 'none')
          tileElement.setAttribute('data-tile', `${level}:${x},${y}`)
          tileElement.setAttribute('shape-rendering', 'optimizeQuality')
          const tileUrl = buildTileUrl(assetId, stats.level, x, y)
          tileElement.setAttributeNS(XLINK_NS, 'href', tileUrl)
          group.appendChild(tileElement)

          if (childStats && childStats.columns > 0 && childStats.rows > 0) {
            const baseX = x * 2
            const baseY = y * 2
            for (let cy = 0; cy < 2; cy += 1) {
              for (let cx = 0; cx < 2; cx += 1) {
                const px = baseX + cx
                const py = baseY + cy
                if (px < childStats.columns && py < childStats.rows) {
                  prefetchTile(assetId, level - 1, px, py)
                }
              }
            }
          }

          if (parentStats && parentStats.columns > 0 && parentStats.rows > 0) {
            const parentX = Math.floor(x / 2)
            const parentY = Math.floor(y / 2)
            if (parentX < parentStats.columns && parentY < parentStats.rows) {
              prefetchTile(assetId, level + 1, parentX, parentY)
            }
          }
          leftPx += stats.tileSize
          x += 1
        }
        topPx += stats.tileSize
        y += 1
      }
      return group
    }

    const createTextElement = (node: SceneNode): SVGElement | null => {
      if (node.type !== 'text' || !node.text) {
        return null
      }
      const textDef = node.text
      const textElement = createSvgElement('text')
      textElement.classList.add('svg-stage__text')
      textElement.setAttribute('xml:space', 'preserve')
      textElement.setAttribute('fill', getFillColor(node))
      const strokeWidth = node.stroke?.width ?? 0
      if (strokeWidth > 0) {
        textElement.setAttribute('stroke', getStrokeColor(node))
        textElement.setAttribute('stroke-width', strokeWidth.toString())
      } else {
        textElement.setAttribute('stroke', 'none')
      }
      textElement.setAttribute('font-family', textDef.fontFamily)
      const targetFontSize = Math.max(textDef.fontSize, Number.EPSILON)
      const domFontSize = Math.min(
        Math.max(targetFontSize, MIN_TEXT_DOM_FONT_SIZE),
        MAX_TEXT_DOM_FONT_SIZE,
      )
      textElement.setAttribute('font-size', domFontSize.toString())
      textElement.setAttribute('font-weight', textDef.fontWeight.toString())
      textElement.setAttribute('font-style', textDef.fontStyle)
      textElement.setAttribute('dominant-baseline', 'alphabetic')
      const fontScale = domFontSize !== targetFontSize && domFontSize > 0 ? targetFontSize / domFontSize : 1
      if (fontScale !== 1) {
        textElement.setAttribute('transform', `scale(${fontScale})`)
      }
      const textAnchor =
        textDef.align === 'center' ? 'middle' : textDef.align === 'right' ? 'end' : 'start'
      textElement.setAttribute('text-anchor', textAnchor)
      if (textDef.underline) {
        textElement.setAttribute('text-decoration', 'underline')
      }

      const safeWidth = Number.isFinite(node.size.width) ? node.size.width : 0
      const safeHeight = Number.isFinite(node.size.height) ? node.size.height : 0
      const bounds = textDef.layoutBounds
      const minYBound = bounds?.minY ?? -safeHeight / 2
      const maxYBound = bounds?.maxY ?? safeHeight / 2
      const centerY = (minYBound + maxYBound) / 2
      const baselineShift = -centerY
      const anchorX =
        textAnchor === 'middle' ? 0 : textAnchor === 'end' ? safeWidth / 2 : -safeWidth / 2
      const lineHeightMultiplier = Number.isFinite(textDef.lineHeight) && textDef.lineHeight > 0 ? textDef.lineHeight : 1
      const lineAdvance = Math.max(textDef.fontSize * lineHeightMultiplier, textDef.fontSize)
      const positionScale = targetFontSize > 0 ? domFontSize / targetFontSize : 1
      const scaledAnchorX = anchorX * positionScale
      const scaledBaselineShift = baselineShift * positionScale
      const scaledLineAdvance = lineAdvance * positionScale
      const lines = textDef.content.split(/\r?\n/)
      lines.forEach((line, index) => {
        const tspan = createSvgElement('tspan')
        tspan.setAttribute('x', scaledAnchorX.toString())
        if (index === 0) {
          tspan.setAttribute('y', scaledBaselineShift.toString())
        } else {
          tspan.setAttribute('dy', scaledLineAdvance.toString())
        }
        tspan.textContent = line.length > 0 ? line : '\u00A0'
        textElement.appendChild(tspan)
      })

      return textElement
    }

    const createNodeBody = (node: SceneNode) => {
      if (node.type === 'shape') {
        return createShapeElement(node)
      }
      if (node.type === 'image') {
        return createImageElement(node)
      }
      if (node.type === 'text') {
        return createTextElement(node)
      }
      return null
    }

    const createNodeHitElement = (node: SceneNode, body: SVGElement) => {
      if (node.type === 'text' || node.type === 'image') {
        const rect = createSvgElement('rect')
        const width = Number.isFinite(node.size.width) ? node.size.width : 0
        const height = Number.isFinite(node.size.height) ? node.size.height : 0
        rect.setAttribute('x', (-width / 2).toString())
        rect.setAttribute('y', (-height / 2).toString())
        rect.setAttribute('width', width.toString())
        rect.setAttribute('height', height.toString())
        rect.setAttribute('fill', 'transparent')
        rect.setAttribute('stroke', 'transparent')
        rect.setAttribute('pointer-events', 'all')
        return rect
      }
      const hitTarget = body.cloneNode(true) as SVGElement
      hitTarget.setAttribute('fill', 'transparent')
      hitTarget.setAttribute('stroke', 'transparent')
      hitTarget.setAttribute('pointer-events', 'all')
      return hitTarget
    }

    const createNodeElement = (node: SceneNode, isSelected: boolean) => {
      const body = createNodeBody(node)
      if (!body) return null
      const group = createSvgElement('g')
      group.classList.add('svg-stage__node')
      group.dataset.nodeId = node.id
      group.dataset.nodeType = node.type
      if (isSelected) {
        group.classList.add('is-selected')
      }
      const rotation = (node.rotation * 180) / Math.PI
      group.setAttribute('transform', `translate(${node.position.x} ${node.position.y}) rotate(${rotation})`)
      body.classList.add('svg-stage__node-body')
      const hitTarget = createNodeHitElement(node, body)
      hitTarget.classList.add('svg-stage__node-hit')
      group.append(hitTarget, body)
      return group
    }

    const renderNodes = (nodes: SceneNode[], selection: Set<string>) => {
      clearChildren(nodesGroup)
      nodes.forEach((node) => {
        const element = createNodeElement(node, selection.has(node.id))
        if (element) {
          nodesGroup.appendChild(element)
        }
      })
    }

    const renderSelectionOverlay = (selectedNodes: SceneNode[]) => {
      clearChildren(selectionGroup)
      if (selectedNodes.length === 0) {
        selectionGroup.style.display = 'none'
        currentOverlay = null
        return
      }
      const overlay = calculateGroupSelectionOverlay(selectedNodes)
      if (!overlay) {
        selectionGroup.style.display = 'none'
        currentOverlay = null
        return
      }
      selectionGroup.style.display = ''
      currentOverlay = overlay
      const safeScale = Math.max(scale, Number.EPSILON)
      const sizing = calculateSelectionHandleSizing()
      const strokeWidth = sizing.strokeWidth / safeScale
      const cornerRadius = sizing.cornerRadius / safeScale
      const edgeRadius = sizing.edgeRadius / safeScale
      const rotationRadius = sizing.rotationRadius / safeScale
      const toPathPoint = (point: Vec2) => toWorld(overlay, point)
      const cornersWorld = overlay.corners.map(toPathPoint)
      const outlinePath = createSvgElement('path')
      const pathData = cornersWorld
        .map((corner, index) => `${index === 0 ? 'M' : 'L'} ${corner.x} ${corner.y}`)
        .join(' ')
      outlinePath.setAttribute('d', `${pathData} Z`)
      outlinePath.setAttribute('fill', 'none')
      outlinePath.setAttribute('stroke', SELECTION_OUTLINE_COLOR)
      outlinePath.setAttribute('stroke-width', strokeWidth.toString())
      selectionGroup.appendChild(outlinePath)

      overlay.corners.forEach((corner) => {
        const worldCorner = toPathPoint(corner)
        const circle = createSvgElement('circle')
        circle.setAttribute('cx', worldCorner.x.toString())
        circle.setAttribute('cy', worldCorner.y.toString())
        circle.setAttribute('r', cornerRadius.toString())
        circle.setAttribute('fill', SELECTION_CORNER_COLOR)
        selectionGroup.appendChild(circle)
      })

      overlay.edges.forEach((edge) => {
        const worldEdge = toPathPoint(edge)
        const circle = createSvgElement('circle')
        circle.setAttribute('cx', worldEdge.x.toString())
        circle.setAttribute('cy', worldEdge.y.toString())
        circle.setAttribute('r', edgeRadius.toString())
        circle.setAttribute('fill', SELECTION_EDGE_COLOR)
        selectionGroup.appendChild(circle)
      })

      // Keep rotation handle offset roughly 40 screen px regardless of zoom
      const desiredRotationOffsetPx = 40
      const offsetWorld = desiredRotationOffsetPx / safeScale
      const rotationArmStart = toPathPoint({ x: 0, y: -overlay.height / 2 })
      const rotationHandleWorld = toPathPoint({ x: 0, y: -overlay.height / 2 - offsetWorld })
      const rotationArm = createSvgElement('line')
      rotationArm.setAttribute('x1', rotationArmStart.x.toString())
      rotationArm.setAttribute('y1', rotationArmStart.y.toString())
      rotationArm.setAttribute('x2', rotationHandleWorld.x.toString())
      rotationArm.setAttribute('y2', rotationHandleWorld.y.toString())
      rotationArm.setAttribute('stroke', SELECTION_ROTATION_COLOR)
      rotationArm.setAttribute('stroke-width', strokeWidth.toString())
      selectionGroup.appendChild(rotationArm)

      const rotationCircle = createSvgElement('circle')
      rotationCircle.setAttribute('cx', rotationHandleWorld.x.toString())
      rotationCircle.setAttribute('cy', rotationHandleWorld.y.toString())
      rotationCircle.setAttribute('r', rotationRadius.toString())
      rotationCircle.setAttribute('fill', SELECTION_ROTATION_COLOR)
      selectionGroup.appendChild(rotationCircle)
    }

    const detectHandleAtPoint = (worldPoint: Vec2, overlay: SelectionOverlayGeometry): HandleHit | null => {
      const sizing = calculateSelectionHandleSizing()
      const pointerScreen = worldToScreen(worldPoint)
      const toScreenFromLocal = (local: Vec2) => worldToScreen(toWorld(overlay, local))
      const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)
      const cornerThreshold = Math.max(sizing.cornerRadius * HANDLE_HIT_PADDING, HANDLE_HIT_MIN_PX)
      const edgeThreshold = Math.max(sizing.edgeRadius * HANDLE_HIT_PADDING, HANDLE_HIT_MIN_PX)
      const rotationThreshold = Math.max(sizing.rotationRadius * HANDLE_HIT_PADDING, HANDLE_HIT_MIN_PX)

      for (const corner of overlay.corners) {
        const handleScreen = toScreenFromLocal(corner)
        if (distance(pointerScreen, handleScreen) <= cornerThreshold) {
          return { kind: 'corner', position: corner }
        }
      }

      for (const edge of overlay.edges) {
        const handleScreen = toScreenFromLocal(edge)
        if (distance(pointerScreen, handleScreen) <= edgeThreshold) {
          const axis = Math.abs(edge.x) > Math.abs(edge.y) ? 'x' : 'y'
          return { kind: 'edge', position: edge, axis }
        }
      }

      const safeScale = Math.max(scale, Number.EPSILON)
      const desiredRotationOffsetPx = 40
      const offsetWorld = desiredRotationOffsetPx / safeScale
      const rotationHandleWorld = toWorld(overlay, { x: 0, y: -overlay.height / 2 - offsetWorld })
      const rotationScreen = worldToScreen(rotationHandleWorld)
      if (distance(pointerScreen, rotationScreen) <= rotationThreshold) {
        return { kind: 'rotate', position: rotationHandleWorld }
      }

      return null
    }

    const renderMarqueeOverlay = (marquee: { active: boolean; start: Vec2 | null; end: Vec2 | null }) => {
      clearChildren(marqueeGroup)
      if (!marquee.active || !marquee.start || !marquee.end) {
        marqueeGroup.style.display = 'none'
        return
      }
      marqueeGroup.style.display = ''
      const start = marquee.start
      const end = marquee.end
      const minX = Math.min(start.x, end.x)
      const minY = Math.min(start.y, end.y)
      const width = Math.max(Math.abs(end.x - start.x), Number.EPSILON)
      const height = Math.max(Math.abs(end.y - start.y), Number.EPSILON)
      const safeScale = Math.max(scale, Number.EPSILON)
      const rect = createSvgElement('rect')
      rect.setAttribute('x', minX.toString())
      rect.setAttribute('y', minY.toString())
      rect.setAttribute('width', width.toString())
      rect.setAttribute('height', height.toString())
      rect.setAttribute('fill', MARQUEE_FILL_COLOR)
      rect.setAttribute('fill-opacity', MARQUEE_FILL_OPACITY.toString())
      rect.setAttribute('stroke', MARQUEE_STROKE_COLOR)
      rect.setAttribute('stroke-width', (1 / safeScale).toString())
      rect.setAttribute('stroke-dasharray', `${6 / safeScale} ${4 / safeScale}`)
      marqueeGroup.appendChild(rect)
    }

    const initialWorld = storeApi.getState().world
    let translation: Vec2 = { ...initialWorld.position }
    let scale = clampScale(initialWorld.scale || 1)
    let lastNodes = storeApi.getState().nodes
    let lastSelectedList = storeApi.getState().selectedIds
    let selectedIds = new Set(lastSelectedList)
    let selectedNodesCache: SceneNode[] = []
    let marqueeState = storeApi.getState().marquee
    let currentOverlay: SelectionOverlayGeometry | null = null
    let lastRenderedScale = scale
    let viewOnly = storeApi.getState().viewOnly

    type PointerMode = 'idle' | 'pan' | 'marquee' | 'translate' | 'scale' | 'rotate' | 'touch'
    const pointerState = {
      active: false,
      pointerId: -1,
      lastScreen: { x: 0, y: 0 },
      mode: 'idle' as PointerMode,
      marqueeAdditive: false,
      lastWorld: { x: 0, y: 0 },
      transformOverlay: null as SelectionOverlayGeometry | null,
      scaleHandle: null as HandleHit | null,
      scaleLastAbsolute: { x: 1, y: 1 },
      scaleAxis: 'both' as 'both' | 'x' | 'y',
      rotateLastAngle: 0,
    }

    const touchPointers = new Map<number, Vec2>()
    let pinchState: {
      pointerIds: [number, number]
      startDistance: number
      startScale: number
      centerWorld: Vec2
    } | null = null

    const renderOverlays = () => {
      renderSelectionOverlay(selectedNodesCache)
      renderMarqueeOverlay(marqueeState)
    }

    const renderScene = (nodes: SceneNode[], selection: Set<string>) => {
      renderNodes(nodes, selection)
      selectedNodesCache = nodes.filter((node) => selection.has(node.id))
      renderOverlays()
      if (pointerState.mode === 'scale') {
        pointerState.transformOverlay = currentOverlay
      }
      lastRenderedScale = scale
    }

    renderScene(lastNodes, selectedIds)

    let lastGridScale = Number.NaN
    let lastGridSpacing = Number.NaN

    const renderGrid = (force = false) => {
      if (!gridVisible) {
        gridGroup.style.display = 'none'
        clearChildren(gridGroup)
        return
      }
      gridGroup.style.display = ''
      const { width, height } = getViewportSize()
      if (width <= 0 || height <= 0) return
      const safeScale = Math.max(scale, Number.EPSILON)
      const padX = (width / safeScale) * 2
      const padY = (height / safeScale) * 2
      const rawMinX = (0 - translation.x) / safeScale - padX
      const rawMaxX = (width - translation.x) / safeScale + padX
      const rawMinY = (0 - translation.y) / safeScale - padY
      const rawMaxY = (height - translation.y) / safeScale + padY
      const worldPerPixel = 1 / safeScale
      let spacing = Number.isFinite(GRID_MAJOR_BASE) && GRID_MAJOR_BASE > 0 ? GRID_MAJOR_BASE : 64
      const adjustForMaxLines = () => {
        const rangeX = rawMaxX - rawMinX
        const rangeY = rawMaxY - rawMinY
        while (rangeX / spacing > MAX_GRID_LINES || rangeY / spacing > MAX_GRID_LINES) {
          spacing *= 2
        }
      }
      const normalizeSpacing = () => {
        let spacingPx = spacing / worldPerPixel
        while (spacingPx < GRID_MIN_SCREEN_SPACING) {
          spacing *= 2
          spacingPx = spacing / worldPerPixel
        }
        while (spacingPx > GRID_MIN_SCREEN_SPACING * 2) {
          spacing /= 2
          spacingPx = spacing / worldPerPixel
        }
      }
      normalizeSpacing()
      adjustForMaxLines()

      if (!force && Math.abs(safeScale - lastGridScale) < 1e-3 && Math.abs(spacing - lastGridSpacing) < 1e-3) {
        return
      }

      clearChildren(gridGroup)
      lastGridScale = safeScale
      lastGridSpacing = spacing
      const spacingPx = spacing / worldPerPixel
      const minX = Math.floor(rawMinX / spacing) * spacing
      const maxX = Math.ceil(rawMaxX / spacing) * spacing
      const minY = Math.floor(rawMinY / spacing) * spacing
      const maxY = Math.ceil(rawMaxY / spacing) * spacing

      const appendLine = (x1: number, y1: number, x2: number, y2: number, color: string, widthPx: number, alpha: number) => {
        const line = createSvgElement('line')
        line.setAttribute('x1', x1.toString())
        line.setAttribute('y1', y1.toString())
        line.setAttribute('x2', x2.toString())
        line.setAttribute('y2', y2.toString())
        line.setAttribute('stroke', color)
        line.setAttribute('stroke-width', (widthPx / safeScale).toString())
        line.setAttribute('stroke-opacity', alpha.toString())
        line.setAttribute('shape-rendering', 'crispEdges')
        gridGroup.appendChild(line)
      }

      const drawLines = (step: number, color: string, alpha: number, widthPx: number) => {
        if (!Number.isFinite(step) || step <= 0) return
        const startX = Math.floor(minX / step) * step
        const endX = Math.ceil(maxX / step) * step
        for (let x = startX; x <= endX; x += step) {
          appendLine(x, minY, x, maxY, color, widthPx, alpha)
        }
        const startY = Math.floor(minY / step) * step
        const endY = Math.ceil(maxY / step) * step
        for (let y = startY; y <= endY; y += step) {
          appendLine(minX, y, maxX, y, color, widthPx, alpha)
        }
      }

      const majorWidthPx = 1.6
      const minorWidthPx = 1.1
      const microWidthPx = 0.8

      const minorSpacing = spacing / 2
      const microSpacing = spacing / 4
      const minorSpacingPx = spacingPx / 2
      const microSpacingPx = spacingPx / 4

      if (microSpacingPx >= GRID_MIN_SCREEN_SPACING / 3) {
        drawLines(microSpacing, GRID_COLOR_MICRO, 0.35, microWidthPx)
      }
      if (minorSpacingPx >= GRID_MIN_SCREEN_SPACING / 1.5) {
        drawLines(minorSpacing, GRID_COLOR_MINOR, 0.45, minorWidthPx)
      }
      drawLines(spacing, GRID_COLOR_MAJOR, 0.75, majorWidthPx)

      const axisWidthPx = 2
      if (minX <= 0 && maxX >= 0) {
        appendLine(0, minY, 0, maxY, GRID_COLOR_AXIS, axisWidthPx, 0.8)
      }
      if (minY <= 0 && maxY >= 0) {
        appendLine(minX, 0, maxX, 0, GRID_COLOR_AXIS, axisWidthPx, 0.8)
      }
    }

    const updateOriginMarker = () => {
      if (!originVisible) {
        originGroup.style.display = 'none'
        return
      }
      originGroup.style.display = ''
      const safeScale = Math.max(scale, Number.EPSILON)
      const radius = ORIGIN_DOT_RADIUS / safeScale
      const crossLength = ORIGIN_ARM_LENGTH / safeScale
      const ringWidth = ORIGIN_RING_WIDTH / safeScale
      const crossWidth = ORIGIN_CROSS_WIDTH / safeScale
      originCircle.setAttribute('r', radius.toString())
      originCircle.setAttribute('fill', ORIGIN_FILL_COLOR)
      originCircle.setAttribute('stroke', ORIGIN_RING_COLOR)
      originCircle.setAttribute('stroke-width', ringWidth.toString())
      originCrossX.setAttribute('x1', (-crossLength).toString())
      originCrossX.setAttribute('y1', '0')
      originCrossX.setAttribute('x2', crossLength.toString())
      originCrossX.setAttribute('y2', '0')
      originCrossX.setAttribute('stroke', ORIGIN_CROSS_COLOR)
      originCrossX.setAttribute('stroke-width', crossWidth.toString())
      originCrossY.setAttribute('x1', '0')
      originCrossY.setAttribute('y1', (-crossLength).toString())
      originCrossY.setAttribute('x2', '0')
      originCrossY.setAttribute('y2', crossLength.toString())
      originCrossY.setAttribute('stroke', ORIGIN_CROSS_COLOR)
      originCrossY.setAttribute('stroke-width', crossWidth.toString())
    }

    const renderGuides = (forceGrid = false) => {
      renderGrid(forceGrid)
      updateOriginMarker()
    }

    const shouldCenterOrigin = translation.x === 0 && translation.y === 0
    if (shouldCenterOrigin) {
      const width = host.clientWidth || hostBounds.width
      const height = host.clientHeight || hostBounds.height
      translation = { x: width / 2, y: height / 2 }
    }

    let pendingFrame = 0
    const applyTransform = () => {
      const run = () => {
        pendingFrame = 0
        svg.style.transform = `translate(${translation.x}px, ${translation.y}px) scale(${scale})`
        renderGuides()
        renderOverlays()
        if (Math.abs(scale - lastRenderedScale) > 1e-4) {
          renderScene(lastNodes, selectedIds)
        }
      }
      if (pendingFrame) return
      pendingFrame = requestAnimationFrame(run)
    }

    applyTransform()

    let syncingWorld = false
    let pendingWorldFrame = 0
    const syncWorldState = () => {
      if (pendingWorldFrame) return
      pendingWorldFrame = requestAnimationFrame(() => {
        pendingWorldFrame = 0
        syncingWorld = true
        try {
          storeApi.getState().updateWorldTransform({ position: { ...translation }, scale })
        } finally {
          syncingWorld = false
        }
      })
    }

    syncWorldState()

    const updateViewport = () => {
      refreshHostBounds()
      const { width, height } = getViewportSize()
      storeApi.getState().updateViewport({ width, height })
      renderGuides()
    }

    updateViewport()

    const resizeObserver = new ResizeObserver(() => updateViewport())
    resizeObserver.observe(host)

    const screenToWorld = (point: Vec2): Vec2 => ({
      x: (point.x - translation.x) / scale,
      y: (point.y - translation.y) / scale,
    })

    const worldToScreen = (point: Vec2): Vec2 => ({
      x: point.x * scale + translation.x,
      y: point.y * scale + translation.y,
    })

    const setScaleAroundPoint = (nextScale: number, pivot?: Vec2) => {
      const clamped = clampScale(nextScale)
      const pivotPoint = pivot ?? { x: hostBounds.width / 2, y: hostBounds.height / 2 }
      const worldPoint = screenToWorld(pivotPoint)
      scale = clamped
      translation = {
        x: pivotPoint.x - worldPoint.x * scale,
        y: pivotPoint.y - worldPoint.y * scale,
      }
      applyTransform()
      syncWorldState()
    }

    const translateBy = (delta: Vec2) => {
      translation = { x: translation.x + delta.x, y: translation.y + delta.y }
      applyTransform()
      syncWorldState()
    }

    const keyboard = {
      spacePressed: false,
    }

    let transformQueueFrame = 0
    let transformQueue = {
      translate: { x: 0, y: 0 },
      scale: null as { center: Vec2; scaleX: number; scaleY: number } | null,
      rotate: null as { center: Vec2; delta: number } | null,
    }

    const flushTransformQueue = () => {
      transformQueueFrame = 0
      const queue = transformQueue
      transformQueue = {
        translate: { x: 0, y: 0 },
        scale: null,
        rotate: null,
      }
      const state = storeApi.getState()
      if (queue.translate.x !== 0 || queue.translate.y !== 0) {
        state.translateSelected(queue.translate, { record: false })
      }
      if (queue.scale) {
        state.scaleSelected(queue.scale.center, queue.scale.scaleX, queue.scale.scaleY, { record: false })
      }
      if (queue.rotate) {
        state.rotateSelected(queue.rotate.center, queue.rotate.delta, { record: false })
      }
    }

    const scheduleTransformFlush = () => {
      if (transformQueueFrame) return
      transformQueueFrame = requestAnimationFrame(flushTransformQueue)
    }

    const forceFlushTransformQueue = () => {
      if (transformQueueFrame) {
        cancelAnimationFrame(transformQueueFrame)
        transformQueueFrame = 0
      }
      flushTransformQueue()
    }

    const capturePointer = (event: PointerEvent) => {
      host.setPointerCapture?.(event.pointerId)
    }

    const releasePointer = (pointerId: number) => {
      if (pointerId >= 0) {
        host.releasePointerCapture?.(pointerId)
      }
    }

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true
      return Boolean(target.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'))
    }

    const getScaleCursor = () => {
      switch (pointerState.scaleAxis) {
        case 'x':
          return 'ew-resize'
        case 'y':
          return 'ns-resize'
        default:
          return 'nwse-resize'
      }
    }

    const updateCursor = () => {
      if (pointerState.mode === 'pan' || keyboard.spacePressed) {
        host.style.cursor = pointerState.active ? 'grabbing' : 'grab'
      } else if (pointerState.mode === 'marquee') {
        host.style.cursor = 'crosshair'
      } else if (pointerState.mode === 'translate') {
        host.style.cursor = pointerState.active ? 'grabbing' : 'move'
      } else if (pointerState.mode === 'scale') {
        host.style.cursor = getScaleCursor()
      } else if (pointerState.mode === 'rotate') {
        host.style.cursor = 'grabbing'
      } else {
        host.style.cursor = 'default'
      }
    }

    const isPointInsideNode = (node: SceneNode, worldPoint: Vec2) => {
      const dx = worldPoint.x - node.position.x
      const dy = worldPoint.y - node.position.y
      const cos = Math.cos(-node.rotation)
      const sin = Math.sin(-node.rotation)
      const localX = dx * cos - dy * sin
      const localY = dx * sin + dy * cos
      const halfW = node.size.width / 2
      const halfH = node.size.height / 2
      return Math.abs(localX) <= halfW && Math.abs(localY) <= halfH
    }

    const pickNodesAtScreenPoint = (screenPoint: Vec2): SceneNode[] => {
      const worldPoint = screenToWorld(screenPoint)
      const hits: SceneNode[] = []
      for (let i = lastNodes.length - 1; i >= 0; i -= 1) {
        const node = lastNodes[i]
        if (isPointInsideNode(node, worldPoint)) {
          hits.push(node)
        }
      }
      return hits
    }

    const selectNode = (nodeId: string, additive: boolean, toggle: boolean) => {
      const state = storeApi.getState()
      if (toggle) {
        state.toggleSelection(nodeId)
        return
      }
      if (additive) {
        const next = Array.from(new Set([...state.selectedIds, nodeId]))
        state.setSelection(next)
        return
      }
      state.setSelection([nodeId])
    }

    const startPan = (event: PointerEvent) => {
      event.preventDefault()
      pointerState.active = true
      pointerState.mode = 'pan'
      pointerState.pointerId = event.pointerId
      pointerState.lastScreen = { x: event.clientX, y: event.clientY }
      capturePointer(event)
      updateCursor()
    }

    const startTranslateSelection = (worldPoint: Vec2, event: PointerEvent) => {
      event.preventDefault()
      pointerState.active = true
      pointerState.mode = 'translate'
      pointerState.pointerId = event.pointerId
      pointerState.lastWorld = worldPoint
      storeApi.getState().startTransformSession()
      capturePointer(event)
      updateCursor()
    }

    const startScaleSelection = (handle: HandleHit & { kind: 'corner' | 'edge' }, event: PointerEvent) => {
      const overlaySnapshot = currentOverlay
      if (!overlaySnapshot) return
      event.preventDefault()
      pointerState.active = true
      pointerState.mode = 'scale'
      pointerState.pointerId = event.pointerId
      pointerState.transformOverlay = overlaySnapshot
      pointerState.scaleHandle = handle
      pointerState.scaleAxis = handle.kind === 'edge' ? handle.axis : 'both'
      pointerState.scaleLastAbsolute = { x: 1, y: 1 }
      storeApi.getState().startTransformSession()
      capturePointer(event)
      updateCursor()
    }

    const startRotateSelection = (_handle: HandleHit & { kind: 'rotate' }, worldPoint: Vec2, event: PointerEvent) => {
      const overlaySnapshot = currentOverlay
      if (!overlaySnapshot) return
      event.preventDefault()
      pointerState.active = true
      pointerState.mode = 'rotate'
      pointerState.pointerId = event.pointerId
      pointerState.transformOverlay = overlaySnapshot
      const local = toLocal(overlaySnapshot, worldPoint)
      pointerState.rotateLastAngle = Math.atan2(local.y, local.x)
      storeApi.getState().startTransformSession()
      capturePointer(event)
      updateCursor()
    }

    const startMarquee = (event: PointerEvent, additive: boolean) => {
      event.preventDefault()
      const worldPoint = screenToWorld(getHostPoint(event))
      storeApi.getState().startMarquee(worldPoint)
      pointerState.active = true
      pointerState.mode = 'marquee'
      pointerState.pointerId = event.pointerId
      pointerState.lastScreen = { x: event.clientX, y: event.clientY }
      pointerState.marqueeAdditive = additive
      capturePointer(event)
      updateCursor()
    }

    const finishMarqueeSelection = () => {
      const state = storeApi.getState()
      const marquee = state.marquee
      if (!marquee.active || !marquee.start || !marquee.end) {
        state.endMarquee()
        return
      }
      const dx = Math.abs(marquee.end.x - marquee.start.x)
      const dy = Math.abs(marquee.end.y - marquee.start.y)
      const additive = pointerState.marqueeAdditive
      if (dx < 2 && dy < 2) {
        if (!additive) {
          state.clearSelection()
        }
      } else {
        const box = {
          minX: Math.min(marquee.start.x, marquee.end.x),
          minY: Math.min(marquee.start.y, marquee.end.y),
          maxX: Math.max(marquee.start.x, marquee.end.x),
          maxY: Math.max(marquee.start.y, marquee.end.y),
        }
        state.marqueeSelect(box, additive)
      }
      state.endMarquee()
    }

    const finishTransformSession = () => {
      forceFlushTransformQueue()
      if (pointerState.mode === 'translate' || pointerState.mode === 'scale' || pointerState.mode === 'rotate') {
        storeApi.getState().commitTransformSession()
      }
      pointerState.transformOverlay = null
      pointerState.scaleHandle = null
      pointerState.scaleLastAbsolute = { x: 1, y: 1 }
      pointerState.scaleAxis = 'both'
    }

    const updateTouchPointer = (event: PointerEvent) => {
      touchPointers.set(event.pointerId, getHostPoint(event))
    }

    const removeTouchPointer = (pointerId: number) => {
      touchPointers.delete(pointerId)
      if (pinchState && pinchState.pointerIds.includes(pointerId)) {
        endPinchGesture()
        if (touchPointers.size >= 2) {
          startPinchGesture()
        }
      }
    }

    const getTouchPairs = () => {
      const entries = Array.from(touchPointers.entries())
      if (entries.length < 2) return null
      return entries.slice(0, 2)
    }

    const startPinchGesture = () => {
      const pair = getTouchPairs()
      if (!pair) return
      if (pointerState.active) {
        if (pointerState.mode === 'marquee') {
          finishMarqueeSelection()
        }
        if (pointerState.mode === 'translate' || pointerState.mode === 'scale' || pointerState.mode === 'rotate') {
          finishTransformSession()
        }
        releasePointer(pointerState.pointerId)
        pointerState.active = false
        pointerState.pointerId = -1
      }
      const [[idA, pointA], [idB, pointB]] = pair
      const center = {
        x: (pointA.x + pointB.x) / 2,
        y: (pointA.y + pointB.y) / 2,
      }
      const distance = Math.max(Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y), 1e-3)
      pinchState = {
        pointerIds: [idA, idB],
        startDistance: distance,
        startScale: scale,
        centerWorld: screenToWorld(center),
      }
      pointerState.mode = 'touch'
    }

    const updatePinchTransform = () => {
      if (!pinchState) return
      const [idA, idB] = pinchState.pointerIds
      const pointA = touchPointers.get(idA)
      const pointB = touchPointers.get(idB)
      if (!pointA || !pointB) {
        return
      }
      const center = {
        x: (pointA.x + pointB.x) / 2,
        y: (pointA.y + pointB.y) / 2,
      }
      const distance = Math.max(Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y), 1e-3)
      const scaleRatio = distance / pinchState.startDistance
      const nextScale = clampScale(pinchState.startScale * (Number.isFinite(scaleRatio) ? scaleRatio : 1))
      scale = nextScale
      translation = {
        x: center.x - pinchState.centerWorld.x * scale,
        y: center.y - pinchState.centerWorld.y * scale,
      }
      applyTransform()
      syncWorldState()
    }

    const endPinchGesture = () => {
      pinchState = null
      pointerState.mode = 'idle'
    }

    let lastContextDown: { time: number; x: number; y: number } | null = null

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenu) {
        setContextMenu(null)
      }
      const isMouse = event.pointerType === 'mouse'
      if (isMouse && event.button !== 0 && event.button !== 1 && event.button !== 2) return
      if (!isMouse && event.button === -1) {
        // normalize touch/pen buttons so we still handle taps/drags
        ;(event as any).button = 0
      }
      if (event.button === 2) {
        lastContextDown = { time: Date.now(), x: event.clientX, y: event.clientY }
      }
      if (event.pointerType === 'touch') {
        updateTouchPointer(event)
        if (pointerState.mode === 'touch') {
          event.preventDefault()
          return
        }
        if (touchPointers.size >= 2) {
          event.preventDefault()
          startPinchGesture()
          return
        }
      }
      const hostPoint = getHostPoint(event)
      const worldPoint = screenToWorld(hostPoint)
      const overlay = currentOverlay
      const hasSelection = selectedIds.size > 0
      const modifierActive = event.shiftKey || event.metaKey || event.ctrlKey
      if (!viewOnly && event.button === 0 && overlay && hasSelection && !keyboard.spacePressed) {
        const handleHit = detectHandleAtPoint(worldPoint, overlay)
        if (handleHit) {
          if (handleHit.kind === 'rotate') {
            startRotateSelection(handleHit, worldPoint, event)
          } else {
            startScaleSelection(handleHit, event)
          }
          return
        }
        if (!modifierActive && isPointInsideOverlay(overlay, worldPoint)) {
          startTranslateSelection(worldPoint, event)
          return
        }
      }
      const toggle = event.metaKey || event.ctrlKey
      const additive = event.shiftKey
      const hits = pickNodesAtScreenPoint(hostPoint)
      const topHit = hits.find((node) => !node.locked)
      const isPrimary = event.button === 0 || event.pointerType === 'touch'
      if (topHit && isPrimary && !keyboard.spacePressed) {
        const alreadySelected = selectedIds.has(topHit.id)
        if (!alreadySelected || toggle || additive) {
          event.preventDefault()
          selectNode(topHit.id, additive, toggle)
          return
        }
        if (!viewOnly) {
          startTranslateSelection(worldPoint, event)
        }
        return
      }
      const shouldPan = (!isPrimary && event.pointerType !== 'touch') || keyboard.spacePressed || event.button === 2
      if (shouldPan) {
        startPan(event)
        return
      }
      startMarquee(event, additive)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        updateTouchPointer(event)
        if (pointerState.mode === 'touch' && pinchState) {
          event.preventDefault()
          updatePinchTransform()
          return
        }
      }
      if (!pointerState.active || event.pointerId !== pointerState.pointerId) return
      event.preventDefault()
      if (pointerState.mode === 'translate') {
        if (viewOnly) return
        const worldPoint = screenToWorld(getHostPoint(event))
        const delta = { x: worldPoint.x - pointerState.lastWorld.x, y: worldPoint.y - pointerState.lastWorld.y }
        pointerState.lastWorld = worldPoint
        if (Math.abs(delta.x) > 0 || Math.abs(delta.y) > 0) {
          transformQueue.translate = {
            x: transformQueue.translate.x + delta.x,
            y: transformQueue.translate.y + delta.y,
          }
          scheduleTransformFlush()
        }
        return
      }
      if (pointerState.mode === 'scale') {
        if (viewOnly) return
        const overlaySnapshot = pointerState.transformOverlay
        const handle = pointerState.scaleHandle
        if (!overlaySnapshot || !handle) return
        const worldPoint = screenToWorld(getHostPoint(event))
        const local = toLocal(overlaySnapshot, worldPoint)
        const halfWidth = Math.max(overlaySnapshot.width / 2, 1e-4)
        const halfHeight = Math.max(overlaySnapshot.height / 2, 1e-4)
        let absScaleX = pointerState.scaleLastAbsolute.x
        let absScaleY = pointerState.scaleLastAbsolute.y
        if (pointerState.scaleAxis !== 'y') {
          const newHalfWidth = Math.max(Math.abs(local.x), 1e-4)
          absScaleX = Math.max(newHalfWidth / halfWidth, 1e-4)
          if (handle.kind === 'corner') pointerState.scaleAxis = 'both'
        }
        if (pointerState.scaleAxis !== 'x') {
          const newHalfHeight = Math.max(Math.abs(local.y), 1e-4)
          absScaleY = Math.max(newHalfHeight / halfHeight, 1e-4)
          if (handle.kind === 'corner') pointerState.scaleAxis = 'both'
        }
        let deltaScaleX = absScaleX / pointerState.scaleLastAbsolute.x
        let deltaScaleY = absScaleY / pointerState.scaleLastAbsolute.y
        if (!Number.isFinite(deltaScaleX) || deltaScaleX <= 0) deltaScaleX = 1
        if (!Number.isFinite(deltaScaleY) || deltaScaleY <= 0) deltaScaleY = 1
        pointerState.scaleLastAbsolute = { x: absScaleX, y: absScaleY }
        if (Math.abs(deltaScaleX - 1) > 1e-4 || Math.abs(deltaScaleY - 1) > 1e-4) {
          transformQueue.scale = {
            center: overlaySnapshot.center,
            scaleX: absScaleX,
            scaleY: absScaleY,
          }
          scheduleTransformFlush()
        }
        return
      }
      if (pointerState.mode === 'rotate') {
        if (viewOnly) return
        const overlaySnapshot = pointerState.transformOverlay
        if (!overlaySnapshot) return
        const worldPoint = screenToWorld(getHostPoint(event))
        const local = toLocal(overlaySnapshot, worldPoint)
        const currentAngle = Math.atan2(local.y, local.x)
        let delta = currentAngle - pointerState.rotateLastAngle
        if (!Number.isFinite(delta)) delta = 0
        if (Math.abs(delta) > 1e-4) {
          transformQueue.rotate = {
            center: overlaySnapshot.center,
            delta: (transformQueue.rotate?.delta ?? 0) + delta,
          }
          pointerState.rotateLastAngle = currentAngle
          scheduleTransformFlush()
        }
        return
      }
      if (pointerState.mode === 'pan') {
        const deltaX = event.clientX - pointerState.lastScreen.x
        const deltaY = event.clientY - pointerState.lastScreen.y
        if (deltaX === 0 && deltaY === 0) return
        pointerState.lastScreen = { x: event.clientX, y: event.clientY }
        translateBy({ x: deltaX, y: deltaY })
        return
      }
      if (pointerState.mode === 'marquee') {
        pointerState.lastScreen = { x: event.clientX, y: event.clientY }
        const worldPoint = screenToWorld(getHostPoint(event))
        storeApi.getState().updateMarquee(worldPoint)
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        removeTouchPointer(event.pointerId)
        if (pointerState.mode === 'touch') {
          event.preventDefault()
          if (!pinchState) {
            pointerState.mode = 'idle'
          }
          return
        }
      }
      if (contextMenu) {
        setContextMenu(null)
      }
      if (event.pointerId !== pointerState.pointerId) return
      if (pointerState.mode === 'marquee') {
        finishMarqueeSelection()
      }
      if (pointerState.mode === 'translate' || pointerState.mode === 'scale' || pointerState.mode === 'rotate') {
        finishTransformSession()
      }
      pointerState.mode = 'idle'
      pointerState.active = false
      pointerState.pointerId = -1
      releasePointer(event.pointerId)
      updateCursor()
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        removeTouchPointer(event.pointerId)
        if (pointerState.mode === 'touch') {
          if (!pinchState) {
            pointerState.mode = 'idle'
          }
          return
        }
      }
      if (event.pointerId !== pointerState.pointerId) return
      if (pointerState.mode === 'marquee') {
        storeApi.getState().endMarquee()
      }
      if (pointerState.mode === 'translate' || pointerState.mode === 'scale' || pointerState.mode === 'rotate') {
        finishTransformSession()
      }
      pointerState.mode = 'idle'
      pointerState.active = false
      pointerState.pointerId = -1
      releasePointer(event.pointerId)
      updateCursor()
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      refreshHostBounds()
      const pivot = getHostPoint(event)
      const sensitivity = event.ctrlKey ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY
      const zoomFactor = Math.exp(-event.deltaY * sensitivity)
      const nextScale = scale * zoomFactor
      setScaleAroundPoint(nextScale, pivot)
    }

    const handleZoomEvent = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail
      if (typeof detail !== 'number' || !Number.isFinite(detail)) return
      setScaleAroundPoint(detail)
    }

    const unsubscribeWorld = useSceneStore.subscribe((state) => {
      if (syncingWorld) return
      const nextScale = clampScale(state.world.scale)
      const nextPosition = state.world.position
      const scaleChanged = Math.abs(nextScale - scale) > 1e-9
      const posChanged =
        Math.abs(nextPosition.x - translation.x) > 0.5 || Math.abs(nextPosition.y - translation.y) > 0.5
      if (!scaleChanged && !posChanged) return
      scale = nextScale
      translation = { x: nextPosition.x, y: nextPosition.y }
      applyTransform()
    })

    const unsubscribeNodes = useSceneStore.subscribe((state) => {
      if (state.nodes === lastNodes) return
      lastNodes = state.nodes
      renderScene(lastNodes, selectedIds)
    })

    const unsubscribeSelection = useSceneStore.subscribe((state) => {
      if (state.selectedIds === lastSelectedList) return
      lastSelectedList = state.selectedIds
      selectedIds = new Set(state.selectedIds)
      renderScene(lastNodes, selectedIds)
    })

    const unsubscribeViewOnly = useSceneStore.subscribe((state) => {
      viewOnly = state.viewOnly
    })

    const unsubscribeMarquee = useSceneStore.subscribe((state) => {
      if (state.marquee === marqueeState) return
      marqueeState = state.marquee
      renderMarqueeOverlay(marqueeState)
    })

    const unsubscribeShowGrid = useSceneStore.subscribe((state) => {
      if (state.showGrid === gridVisible) return
      gridVisible = state.showGrid
      renderGrid(true)
    })

    const unsubscribeShowOrigin = useSceneStore.subscribe((state) => {
      if (state.showOrigin === originVisible) return
      originVisible = state.showOrigin
      updateOriginMarker()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }
      if (event.code === 'Space' && !keyboard.spacePressed) {
        keyboard.spacePressed = true
        updateCursor()
        event.preventDefault()
        return
      }
      if ((event.code === 'Delete' || event.code === 'Backspace') && !isEditableTarget(event.target)) {
        const selectedIds = storeApi.getState().selectedIds
        if (selectedIds.length > 0) {
          event.preventDefault()
          const idsToDelete = [...selectedIds]
          const title = selectedIds.length === 1 ? 'Delete selected item?' : `Delete ${selectedIds.length} items?`
          const message =
            selectedIds.length === 1
              ? 'This will remove the selected node permanently.'
              : 'This will remove all selected nodes permanently.'
          requestConfirmation({
            title,
            message,
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            variant: 'danger',
          }).then((confirmed) => {
            if (confirmed) {
              storeApi.getState().deleteNodes(idsToDelete)
            }
          })
        }
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }
      if (event.code === 'Space') {
        keyboard.spacePressed = false
        updateCursor()
        event.preventDefault()
      }
    }

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      setContextMenu(null)
      const tooLong = lastContextDown && Date.now() - lastContextDown.time > 100
      const dist = lastContextDown
        ? Math.hypot(event.clientX - lastContextDown.x, event.clientY - lastContextDown.y)
        : 0
      if (tooLong || dist > 4) {
        return
      }
      const hostPoint = getHostPoint(event as unknown as PointerEvent)
      const hits = pickNodesAtScreenPoint(hostPoint)
      const locked = hits.filter((n) => n.locked)
      if (locked.length === 0) {
        setContextMenu(null)
        return
      }
      const items = locked.map((node) => ({ id: node.id, name: node.name ?? 'Locked item' }))
      setContextMenu({ x: event.clientX, y: event.clientY, items })
    }

    const dismissContextMenu = (event?: Event) => {
      const target = event?.target
      if (target instanceof HTMLElement && target.closest('.stage-context-menu')) {
        return
      }
      setContextMenu(null)
    }

    host.addEventListener('contextmenu', handleContextMenu)
    host.addEventListener('pointerdown', handlePointerDown)
    host.addEventListener('pointermove', handlePointerMove)
    host.addEventListener('pointerup', handlePointerUp)
    host.addEventListener('pointercancel', handlePointerCancel)
    host.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('pointercancel', handlePointerCancel, true)
    window.addEventListener('pointerdown', dismissContextMenu, true)
    window.addEventListener('scroll', dismissContextMenu, true)
    window.addEventListener(ZOOM_EVENT, handleZoomEvent as EventListener)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      disposed = true
      unsubscribeWorld()
      unsubscribeNodes()
      unsubscribeSelection()
      unsubscribeViewOnly()
      unsubscribeMarquee()
      unsubscribeShowGrid()
      unsubscribeShowOrigin()
      resizeObserver.disconnect()
      gridGroup.remove()
      nodesGroup.remove()
      marqueeGroup.remove()
      selectionGroup.remove()
      originGroup.remove()
      touchPointers.clear()
      pinchState = null
      host.removeEventListener('contextmenu', handleContextMenu)
      host.removeEventListener('pointerdown', handlePointerDown)
      host.removeEventListener('pointermove', handlePointerMove)
      host.removeEventListener('pointerup', handlePointerUp)
      host.removeEventListener('pointercancel', handlePointerCancel)
      host.removeEventListener('wheel', handleWheel)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('pointercancel', handlePointerCancel, true)
      window.removeEventListener('pointerdown', dismissContextMenu, true)
      window.removeEventListener('scroll', dismissContextMenu, true)
      window.removeEventListener(ZOOM_EVENT, handleZoomEvent as EventListener)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  return (
    <>
      <div ref={hostRef} className="stage-host" role="presentation">
        <svg
          ref={svgRef}
          className="svg-stage__root"
          aria-hidden="true"
          focusable="false"
          xmlns="http://www.w3.org/2000/svg"
        />
        <div ref={overlayRef} className="svg-stage__overlay" aria-hidden="true" />
        {contextMenu ? (
          <div
            className="stage-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            role="menu"
            onPointerDownCapture={(event) => {
              event.stopPropagation()
              event.preventDefault()
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
            }}
          >
            {contextMenu.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="stage-context-menu__item"
                onClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  const state = storeApi.getState()
                  state.unlockNodes([item.id])
                  state.setSelection([item.id])
                  setContextMenu(null)
                }}
              >
                Unlock {item.name}
              </button>
            ))}
            <button
              type="button"
              className="stage-context-menu__item stage-context-menu__item--cancel"
              onClick={() => setContextMenu(null)}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
      <ZoomBadge />
    </>
  )
}
