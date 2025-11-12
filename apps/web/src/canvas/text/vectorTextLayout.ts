import type { VectorFont, VectorFontGlyph } from './vectorFont'

export type TextAlign = 'left' | 'center' | 'right'

export interface VectorTextLayoutOptions {
  text: string
  font: VectorFont
  fontSize: number
  lineHeight: number
  align: TextAlign
}

export interface VectorGlyphPlacement {
  glyph: VectorFontGlyph
  x: number
  y: number
}

export interface VectorTextLayoutLine {
  glyphs: VectorGlyphPlacement[]
  width: number
  minX: number
  maxX: number
  baseline: number
}

export interface LayoutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface VectorTextLayout {
  scale: number
  fontSize: number
  lineHeight: number
  bounds: LayoutBounds
  lines: VectorTextLayoutLine[]
}

export function layoutVectorText(options: VectorTextLayoutOptions): VectorTextLayout {
  const { text, font, fontSize, lineHeight, align } = options
  const normalizedAlign: TextAlign = align ?? 'left'
  const lines = text.split(/\r?\n/)
  const unitsPerEm = font.metrics.unitsPerEm || 1000
  const scale = fontSize / unitsPerEm
  const lineAdvance = Math.max(fontSize * lineHeight, fontSize)
  const ascenderPx = font.metrics.ascender * scale
  const descenderPx = font.metrics.descender * scale

  const layoutLines: VectorTextLayoutLine[] = []

  let globalMinX = Number.POSITIVE_INFINITY
  let globalMaxX = Number.NEGATIVE_INFINITY
  let globalMinY = Number.POSITIVE_INFINITY
  let globalMaxY = Number.NEGATIVE_INFINITY

  lines.forEach((lineText, index) => {
    const baseline = index * lineAdvance
    const glyphPlacements: VectorGlyphPlacement[] = []

    let penX = 0
    let lineMinX = Number.POSITIVE_INFINITY
    let lineMaxX = Number.NEGATIVE_INFINITY
    let previousGlyph: VectorFontGlyph | undefined

    for (const char of Array.from(lineText)) {
      const codePoint = char.codePointAt(0)
      if (typeof codePoint !== 'number') {
        continue
      }
      const glyph = font.getGlyph(codePoint) ?? font.fallbackGlyph

      const kerning = previousGlyph ? font.getKerning(previousGlyph.codePoint, glyph.codePoint) : 0
      penX += kerning * scale

      if (glyph.positions.length > 0 && glyph.indices.length > 0) {
        const glyphMinX = penX + glyph.bounds.minX * scale
        const glyphMaxX = penX + glyph.bounds.maxX * scale
        const glyphMinY = baseline + glyph.bounds.minY * scale
        const glyphMaxY = baseline + glyph.bounds.maxY * scale
        lineMinX = Math.min(lineMinX, glyphMinX)
        lineMaxX = Math.max(lineMaxX, glyphMaxX)
        globalMinX = Math.min(globalMinX, glyphMinX)
        globalMaxX = Math.max(globalMaxX, glyphMaxX)
        globalMinY = Math.min(globalMinY, glyphMinY)
        globalMaxY = Math.max(globalMaxY, glyphMaxY)
      }

      glyphPlacements.push({
        glyph,
        x: penX,
        y: baseline,
      })

      penX += glyph.advanceWidth * scale
      previousGlyph = glyph
    }

    const lineWidth = penX
    if (!Number.isFinite(lineMinX)) {
      lineMinX = 0
      lineMaxX = lineWidth
    }

    // Ensure vertical bounds account for ascender/descender even if glyph bounds are missing.
    globalMinY = Math.min(globalMinY, baseline - ascenderPx)
    globalMaxY = Math.max(globalMaxY, baseline - font.metrics.descender * scale)

    let offset = 0
    if (normalizedAlign === 'center') {
      offset = -lineWidth / 2
    } else if (normalizedAlign === 'right') {
      offset = -lineWidth
    }

    if (offset !== 0) {
      for (const placement of glyphPlacements) {
        placement.x += offset
      }
      lineMinX += offset
      lineMaxX += offset
    }

    globalMinX = Math.min(globalMinX, lineMinX)
    globalMaxX = Math.max(globalMaxX, lineMaxX)

    layoutLines.push({
      glyphs: glyphPlacements,
      width: lineWidth,
      minX: lineMinX,
      maxX: lineMaxX,
      baseline,
    })
  })

  if (!Number.isFinite(globalMinX) || !Number.isFinite(globalMaxX)) {
    globalMinX = 0
    globalMaxX = 0
  }

  if (!Number.isFinite(globalMinY) || !Number.isFinite(globalMaxY)) {
    globalMinY = -ascenderPx
    globalMaxY = lineAdvance * Math.max(lines.length, 1) - descenderPx
  }

  const bounds: LayoutBounds = {
    minX: globalMinX,
    maxX: globalMaxX,
    minY: globalMinY,
    maxY: globalMaxY,
    width: Math.max(0, globalMaxX - globalMinX),
    height: Math.max(0, globalMaxY - globalMinY),
  }

  return {
    scale,
    fontSize,
    lineHeight: lineAdvance,
    bounds,
    lines: layoutLines,
  }
}
