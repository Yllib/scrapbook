import type { MsdfOptions, PackedGlyphsBin, FontMetrics } from 'msdfgen-wasm'

export const MIN_FONT_BASE = 32
export const MAX_FONT_BASE = 2048

export interface FontStyleDescriptor {
  fontFamily: string
  fontWeight: number | string
  fontStyle: string
  fontSize: number
}

export interface MsdfFontDescriptor {
  family: string
  weight: number
  italic: boolean
  bucket: number
}

export interface BitmapFontPageLike {
  id: number
  file: string
}

export interface RawCharDataLike {
  id: number
  letter: string
  page: number
  x: number
  y: number
  width: number
  height: number
  xOffset: number
  yOffset: number
  xAdvance: number
  kerning: Record<string, number>
}

export interface BitmapFontDataLike {
  pages: BitmapFontPageLike[]
  chars: Record<string, RawCharDataLike>
  fontFamily: string
  fontSize: number
  lineHeight: number
  baseLineOffset: number
  distanceField: {
    type: 'msdf'
    range: number
  }
}

export const DEFAULT_CHARSET: number[] = (() => {
  const codes = new Set<number>()
  ;[9, 10, 13].forEach((code) => codes.add(code))
  for (let code = 32; code <= 126; code += 1) {
    codes.add(code)
  }
  for (let code = 160; code <= 255; code += 1) {
    codes.add(code)
  }
  return [...codes]
})()

export function extractPrimaryFamily(fontFamily: string): string {
  const primary = fontFamily.split(',')[0] ?? ''
  return primary.replace(/["']/g, '').trim() || 'Inter'
}

export function parseFontWeight(weight: number | string): number {
  if (typeof weight === 'number' && Number.isFinite(weight)) {
    return weight
  }
  if (typeof weight === 'string') {
    const trimmed = weight.trim().toLowerCase()
    if (trimmed === 'normal') return 400
    if (trimmed === 'bold') return 700
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 400
}

export function fontBucket(size: number): number {
  const clamped = Math.min(MAX_FONT_BASE, Math.max(MIN_FONT_BASE, size))
  const exponent = Math.round(Math.log2(clamped))
  return 2 ** exponent
}

export function hashKey(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

export function buildBitmapFontData(params: {
  fontName: string
  family: string
  msdfOptions: MsdfOptions
  bins: PackedGlyphsBin[]
  metrics: FontMetrics
}): BitmapFontDataLike {
  const { fontName, family, msdfOptions, bins, metrics } = params
  const round = (value: number) => Math.round(value * msdfOptions.size * 100) / 100
  const chars: Record<string, RawCharDataLike> = {}

  bins.forEach((bin, pageIndex) => {
    for (const rect of bin.rects) {
      const glyph = rect.glyph
      const range = rect.msdfData.range
      const hasSize = rect.width > 0 && rect.height > 0
      const letter = String.fromCodePoint(glyph.unicode)
      const kerning: Record<string, number> = {}

      for (const [other, amount] of glyph.kerning) {
        kerning[String.fromCodePoint(other.unicode)] = round(amount)
      }

      chars[letter] = {
        id: glyph.unicode,
        letter,
        page: pageIndex,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        xOffset: hasSize ? round(glyph.left - range / 2) : 0,
        yOffset: hasSize ? round(metrics.ascenderY - (glyph.top + range / 2)) : 0,
        xAdvance: round(glyph.advance),
        kerning,
      }
    }
  })

  const pages: BitmapFontPageLike[] = bins.map((_, index) => ({
    id: index,
    file: `${fontName}_page_${index}.png`,
  }))

  return {
    pages,
    chars,
    fontFamily: family,
    fontSize: msdfOptions.size,
    lineHeight: round(metrics.lineHeight),
    baseLineOffset: round(metrics.ascenderY),
    distanceField: {
      type: 'msdf',
      range: msdfOptions.range,
    },
  }
}
