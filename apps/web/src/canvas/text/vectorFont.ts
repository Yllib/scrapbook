import { MeshGeometry } from 'pixi.js'

import {
  descriptorKey,
  extractPrimaryFamily,
  normalizeFontRequest,
  type FontStyleRequest,
  type NormalizedFontDescriptor,
} from './fontUtils'

const MANIFEST_URL = '/vector-fonts/manifest.json'

interface ManifestEntry {
  family: string
  weight: number
  italic: boolean
  style: string
  data: string
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

interface VectorFontAssetGlyph {
  unicode: number | null
  advanceWidth: number
  leftSideBearing: number
  bounds: GlyphBounds
  geometry: {
    positions: number[]
    indices: number[]
  }
}

export interface GlyphBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface VectorFontMetrics {
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
  lineHeight: number
  underlinePosition: number
  underlineThickness: number
  capHeight: number | null
  xHeight: number | null
}

export interface VectorFontGlyph {
  codePoint: number
  unicode: number | null
  advanceWidth: number
  leftSideBearing: number
  bounds: GlyphBounds
  positions: Float32Array
  indices: Uint32Array
  uvs: Float32Array
  meshGeometry?: MeshGeometry
}

export interface VectorFont {
  descriptor: NormalizedFontDescriptor & { style: string }
  metrics: VectorFontMetrics
  glyphs: Map<number, VectorFontGlyph>
  kerning: Map<number, Map<number, number>>
  charset: Set<number>
  quality: number
  getGlyph: (codePoint: number) => VectorFontGlyph | undefined
  getKerning: (left: number, right: number) => number
  fallbackGlyph: VectorFontGlyph
}

const manifestPromiseRef: { current: Promise<Map<string, ManifestEntry>> | null } = { current: null }
const fontPromiseCache = new Map<string, Promise<VectorFont>>()
const fontInstanceCache = new Map<string, VectorFont>()

export async function resolveVectorFont(style: FontStyleRequest): Promise<VectorFont> {
  const normalized = normalizeFontRequest(style)
  return resolveVectorFontByDescriptor(normalized)
}

export async function resolveVectorFontByDescriptor(descriptor: NormalizedFontDescriptor): Promise<VectorFont> {
  const key = descriptorKey(descriptor)
  let fontPromise = fontPromiseCache.get(key)
  if (!fontPromise) {
    fontPromise = loadVectorFont(descriptor).catch((error) => {
      fontPromiseCache.delete(key)
      throw error
    })
    fontPromiseCache.set(key, fontPromise)
  }
  return fontPromise
}

export function getLoadedVectorFont(descriptor: NormalizedFontDescriptor): VectorFont | null {
  return fontInstanceCache.get(descriptorKey(descriptor)) ?? null
}

async function loadVectorFont(descriptor: NormalizedFontDescriptor): Promise<VectorFont> {
  const manifest = await loadManifest()
  const key = descriptorKey(descriptor)
  let entry = manifest.get(key)

  if (!entry) {
    // Attempt to fallback by weight
    const weightFallbackKey = descriptorKey({ ...descriptor, weight: 400 })
    entry = manifest.get(weightFallbackKey)
  }

  if (!entry) {
    // fallback to Inter regular
    entry = manifest.get(descriptorKey({ family: 'Inter', weight: 400, italic: false }))
  }

  if (!entry) {
    console.warn(`[vector-fonts] manifest missing entry for ${descriptor.family}, using placeholder glyphs`)
    const placeholder = createPlaceholderFont(descriptor)
    fontInstanceCache.set(descriptorKey(placeholder.descriptor), placeholder)
    return placeholder
  }

  const response = await fetch(entry.data, { cache: 'force-cache' })
  if (!response.ok) {
    console.warn(`[vector-fonts] failed to load data at ${entry.data}, using placeholder glyphs`)
    const placeholder = createPlaceholderFont(descriptor)
    fontInstanceCache.set(descriptorKey(placeholder.descriptor), placeholder)
    return placeholder
  }

  const asset = (await response.json()) as VectorFontAsset
  const font = parseVectorFontAsset(asset, entry)
  fontInstanceCache.set(descriptorKey(font.descriptor), font)
  return font
}

async function loadManifest(): Promise<Map<string, ManifestEntry>> {
  if (!manifestPromiseRef.current) {
    manifestPromiseRef.current = fetch(MANIFEST_URL, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Vector font manifest not found at ${MANIFEST_URL}`)
        }
        let manifestJson: { entries: ManifestEntry[] }
        try {
          manifestJson = (await response.json()) as { entries: ManifestEntry[] }
        } catch (error) {
          throw new Error(`Vector font manifest response was not JSON: ${error}`)
        }
        const map = new Map<string, ManifestEntry>()
        manifestJson.entries.forEach((entry) => {
          const descriptor: NormalizedFontDescriptor = {
            family: extractPrimaryFamily(entry.family),
            weight: entry.weight,
            italic: entry.italic,
          }
          map.set(descriptorKey(descriptor), entry)
        })
        return map
      })
      .catch((error) => {
        console.error('[vector-fonts] failed to load manifest', error)
        manifestPromiseRef.current = null
        return new Map()
      })
  }
  return manifestPromiseRef.current
}

function parseVectorFontAsset(asset: VectorFontAsset, entry: ManifestEntry): VectorFont {
  const glyphMap = new Map<number, VectorFontGlyph>()
  const charset = new Set<number>(asset.charset ?? [])

  for (const [key, glyphAsset] of Object.entries(asset.glyphs)) {
    const codePoint = Number.parseInt(key, 10)
    if (!Number.isFinite(codePoint)) {
      continue
    }

    const positions = new Float32Array(glyphAsset.geometry.positions)
    const indices = new Uint32Array(glyphAsset.geometry.indices)
    const uvs = new Float32Array(positions.length) // zero-initialised

    const glyph: VectorFontGlyph = {
      codePoint,
      unicode: glyphAsset.unicode ?? null,
      advanceWidth: glyphAsset.advanceWidth,
      leftSideBearing: glyphAsset.leftSideBearing,
      bounds: glyphAsset.bounds,
      positions,
      indices,
      uvs,
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

  const fallbackCodes = [
    '?'.codePointAt(0),
    0x25a1, // white square
    32, // space
  ].filter((code): code is number => typeof code === 'number')

  let fallbackGlyph: VectorFontGlyph | undefined
  for (const code of fallbackCodes) {
    const candidate = glyphMap.get(code)
    if (candidate) {
      fallbackGlyph = candidate
      break
    }
  }
  if (!fallbackGlyph) {
    fallbackGlyph = glyphMap.values().next().value
  }

  const font: VectorFont = {
    descriptor: {
      family: extractPrimaryFamily(entry.family),
      weight: entry.weight,
      italic: entry.italic,
      style: entry.style,
    },
    metrics: asset.metrics,
    glyphs: glyphMap,
    kerning,
    charset,
    quality: asset.quality ?? 1,
    fallbackGlyph: fallbackGlyph,
    getGlyph(codePoint: number) {
      return glyphMap.get(codePoint) ?? fallbackGlyph
    },
    getKerning(left: number, right: number) {
      return kerning.get(left)?.get(right) ?? 0
    },
  }

  return font
}

export function ensureGlyphMeshGeometry(glyph: VectorFontGlyph): MeshGeometry | null {
  if (glyph.positions.length === 0 || glyph.indices.length === 0) {
    return null
  }
  if (!glyph.meshGeometry) {
    glyph.meshGeometry = new MeshGeometry({
      positions: glyph.positions,
      uvs: glyph.uvs,
      indices: glyph.indices,
    })
  }
  return glyph.meshGeometry
}

const PLACEHOLDER_CHARSET: number[] = (() => {
  const codes = new Set<number>()
  for (let code = 32; code <= 126; code += 1) {
    codes.add(code)
  }
  codes.add(0xa0)
  return [...codes]
})()

function createPlaceholderFont(descriptor: NormalizedFontDescriptor): VectorFont {
  const unitsPerEm = 2048
  const ascender = Math.round(unitsPerEm * 0.8)
  const descender = -Math.round(unitsPerEm * 0.25)
  const lineGap = Math.round(unitsPerEm * 0.05)
  const lineHeight = ascender - descender + lineGap
  const underlinePosition = Math.round(descender * 0.5)
  const underlineThickness = Math.round(unitsPerEm * 0.05)

  const glyphs = new Map<number, VectorFontGlyph>()
  const charset = new Set<number>()

  const indices = new Uint32Array([0, 1, 2, 0, 2, 3])

  for (const code of PLACEHOLDER_CHARSET) {
    const unicode = code
    charset.add(code)

    const isWhitespace = code === 32 || code === 0xa0 || code === 9
    const widthMultiplier =
      code === 32 || code === 0xa0 ? 0.35 : code === 46 || code === 44 ? 0.3 : code === 73 ? 0.35 : 0.6
    const advanceWidth = Math.max(1, Math.round(unitsPerEm * widthMultiplier))

    let positions: Float32Array
    let glyphIndices: Uint32Array

    if (isWhitespace) {
      positions = new Float32Array()
      glyphIndices = new Uint32Array()
    } else {
      positions = new Float32Array([
        0,
        0,
        advanceWidth,
        0,
        advanceWidth,
        -ascender,
        0,
        -ascender,
      ])
      glyphIndices = indices.slice()
    }

    const glyph: VectorFontGlyph = {
      codePoint: code,
      unicode,
      advanceWidth,
      leftSideBearing: 0,
      bounds: {
        minX: 0,
        maxX: advanceWidth,
        minY: -ascender,
        maxY: 0,
      },
      positions,
      indices: glyphIndices,
      uvs: new Float32Array(positions.length),
    }

    glyphs.set(code, glyph)
  }

  const kerning = new Map<number, Map<number, number>>()
  const fallbackGlyph = glyphs.get('?'.codePointAt(0) ?? 63) ?? glyphs.get(42)! // '*' fallback

  const font: VectorFont = {
    descriptor: {
      family: descriptor.family,
      weight: descriptor.weight,
      italic: descriptor.italic,
      style: descriptor.italic ? 'italic' : 'normal',
    },
    metrics: {
      unitsPerEm,
      ascender,
      descender,
      lineGap,
      lineHeight,
      underlinePosition,
      underlineThickness,
      capHeight: ascender,
      xHeight: Math.round(ascender * 0.7),
    },
    glyphs,
    kerning,
    charset,
    quality: 1,
    fallbackGlyph,
    getGlyph(codePoint: number) {
      return glyphs.get(codePoint) ?? fallbackGlyph
    },
    getKerning(_: number, __: number) {
      return 0
    },
  }

  return font
}
