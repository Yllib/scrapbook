import { normalizeFontRequest, type FontStyleRequest, type NormalizedFontDescriptor } from './fontUtils'

const MANIFEST_URL = '/vector-fonts/manifest.json'

type GlyphCommand =
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'quadraticCurveTo'; x1: number; y1: number; x: number; y: number }
  | { type: 'bezierCurveTo'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'closePath' }

export interface VectorFontMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
  lineHeight: number
  underlinePosition?: number
  underlineThickness?: number
  capHeight?: number
  xHeight?: number
}

export interface VectorFontGlyph {
  codePoint: number
  unicode: number | null
  advanceWidth: number
  leftSideBearing: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  positions: Float32Array
  indices: Uint32Array
  uvs: Float32Array
  contours: GlyphCommand[][]
}

export interface VectorFont {
  descriptor: NormalizedFontDescriptor
  metrics: VectorFontMetrics
  glyphs: Map<number, VectorFontGlyph>
  kerning: Map<number, Map<number, number>>
  charset: Set<number>
  quality: number
  fallbackGlyph: VectorFontGlyph
  getGlyph: (codePoint: number) => VectorFontGlyph
  getKerning: (left: number, right: number) => number
}

interface ManifestEntry {
  family: string
  weight: number
  italic: boolean
  style: string
  data: string
}

interface VectorFontAssetGlyph {
  unicode: number | null
  advanceWidth: number
  leftSideBearing: number
  bounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  geometry: {
    positions: number[]
    indices: number[]
    contours?: GlyphCommand[][]
  }
}

interface VectorFontAsset {
  version: number
  family: string
  weight: number
  italic: boolean
  style: string
  metrics: VectorFontMetrics
  glyphs: Record<string, VectorFontAssetGlyph>
  kerning?: Record<string, Record<string, number>>
  charset?: number[]
  quality?: number
}

const manifestPromiseRef: { current: Promise<Map<string, ManifestEntry[]>> | null } = { current: null }
const fontPromiseCache = new Map<string, Promise<VectorFont>>()
const fontInstanceCache = new Map<string, VectorFont>()

export async function resolveVectorFont(style: FontStyleRequest): Promise<VectorFont> {
  const descriptor = normalizeFontRequest(style)
  return resolveVectorFontByDescriptor(descriptor)
}

export async function resolveVectorFontByDescriptor(descriptor: NormalizedFontDescriptor): Promise<VectorFont> {
  const cacheKey = descriptorKey(descriptor)
  if (fontInstanceCache.has(cacheKey)) {
    return fontInstanceCache.get(cacheKey)!
  }
  if (!fontPromiseCache.has(cacheKey)) {
    const promise = loadVectorFont(descriptor)
      .then((font) => {
        fontInstanceCache.set(cacheKey, font)
        return font
      })
      .catch((error) => {
        fontPromiseCache.delete(cacheKey)
        throw error
      })
    fontPromiseCache.set(cacheKey, promise)
  }
  return fontPromiseCache.get(cacheKey)!
}

export function getLoadedVectorFont(descriptor: NormalizedFontDescriptor): VectorFont | null {
  const cacheKey = descriptorKey(descriptor)
  return fontInstanceCache.get(cacheKey) ?? null
}

async function loadVectorFont(descriptor: NormalizedFontDescriptor): Promise<VectorFont> {
  const manifest = await loadManifest()
  const entries = manifest.get(descriptorKey(descriptor))
  if (!entries?.length) {
    throw new Error(`[vector-font] missing descriptor ${descriptor.family}`)
  }
  const entry = entries[0]
  const response = await fetch(entry.data, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`[vector-font] failed to load descriptor ${entry.data}`)
  }
  const asset = (await response.json()) as VectorFontAsset
  return parseVectorFontAsset(asset, entry)
}

async function loadManifest(): Promise<Map<string, ManifestEntry[]>> {
  if (!manifestPromiseRef.current) {
    manifestPromiseRef.current = fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`[vector-font] manifest missing at ${MANIFEST_URL}`)
        }
        const data = (await response.json()) as { entries: ManifestEntry[] }
        const map = new Map<string, ManifestEntry[]>()
        for (const entry of data.entries) {
          const key = descriptorKey({
            family: extractPrimaryFamily(entry.family),
            weight: entry.weight,
            italic: entry.italic,
          })
          const existing = map.get(key)
          if (existing) {
            existing.push(entry)
          } else {
            map.set(key, [entry])
          }
        }
        return map
      })
      .catch((error) => {
        console.error('[vector-font] failed to load manifest', error)
        manifestPromiseRef.current = null
        throw error
      })
  }
  return manifestPromiseRef.current!
}

function parseVectorFontAsset(asset: VectorFontAsset, entry: ManifestEntry): VectorFont {
  const glyphMap = new Map<number, VectorFontGlyph>()
  const charset = new Set<number>(asset.charset ?? [])
  for (const [key, glyphAsset] of Object.entries(asset.glyphs)) {
    const codePoint = Number.parseInt(key, 10)
    if (!Number.isFinite(codePoint)) continue
    const positions = new Float32Array(glyphAsset.geometry.positions)
    const indices = new Uint32Array(glyphAsset.geometry.indices)
    const glyph: VectorFontGlyph = {
      codePoint,
      unicode: glyphAsset.unicode,
      advanceWidth: glyphAsset.advanceWidth,
      leftSideBearing: glyphAsset.leftSideBearing,
      bounds: glyphAsset.bounds,
      positions,
      indices,
      uvs: new Float32Array(positions.length),
      contours: glyphAsset.geometry.contours ?? [],
    }
    glyphMap.set(codePoint, glyph)
    charset.add(codePoint)
  }

  const kerning = new Map<number, Map<number, number>>()
  if (asset.kerning) {
    for (const [leftKey, record] of Object.entries(asset.kerning)) {
      const left = Number.parseInt(leftKey, 10)
      if (!Number.isFinite(left)) continue
      let inner = kerning.get(left)
      if (!inner) {
        inner = new Map()
        kerning.set(left, inner)
      }
      for (const [rightKey, value] of Object.entries(record)) {
        const right = Number.parseInt(rightKey, 10)
        if (!Number.isFinite(right)) continue
        inner.set(right, value)
      }
    }
  }

  const fallbackGlyph = glyphMap.values().next().value
  if (!fallbackGlyph) {
    throw new Error('vector font contains no glyphs')
  }

  const descriptor: NormalizedFontDescriptor = {
    family: extractPrimaryFamily(entry.family),
    weight: entry.weight,
    italic: entry.italic,
  }

  const font: VectorFont = {
    descriptor,
    metrics: asset.metrics,
    glyphs: glyphMap,
    kerning,
    charset,
    quality: asset.quality ?? 1,
    fallbackGlyph,
    getGlyph(codePoint: number) {
      return glyphMap.get(codePoint) ?? fallbackGlyph
    },
    getKerning(left: number, right: number) {
      return kerning.get(left)?.get(right) ?? 0
    },
  }

  return font
}

function descriptorKey(descriptor: NormalizedFontDescriptor) {
  const style = descriptor.italic ? 'italic' : 'normal'
  return `${descriptor.family}:${descriptor.weight}:${style}`
}

export function extractPrimaryFamily(value: string) {
  return value.split(',')[0]?.trim() ?? value
}
