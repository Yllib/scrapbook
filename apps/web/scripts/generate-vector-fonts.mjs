#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import opentype from 'opentype.js'
import { buildGeometryFromPath, GraphicsPath } from 'pixi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const FONT_DIR = path.join(PUBLIC_DIR, 'fonts')
const OUTPUT_DIR = path.join(PUBLIC_DIR, 'vector-fonts')

const QUALITY = parseFloat(process.env.VECTOR_GLYPH_QUALITY ?? '1')

const DEFAULT_CHARSET = buildDefaultCharset()

const FONT_DESCRIPTORS = [
  { family: 'Inter', weight: 400, italic: false, file: 'Inter-Regular.ttf', slug: 'regular' },
  { family: 'Inter', weight: 700, italic: false, file: 'Inter-Bold.ttf', slug: 'bold' },
  { family: 'Inter', weight: 400, italic: true, file: 'Inter-Italic.ttf', slug: 'italic' },
]

async function main() {
  console.log('[vector-fonts] generating assets…')

  ensureDirectory(OUTPUT_DIR)

  const manifestEntries = []

  for (const descriptor of FONT_DESCRIPTORS) {
    const fontPath = path.join(FONT_DIR, descriptor.file)
    if (!fs.existsSync(fontPath)) {
      console.warn(`[vector-fonts] missing font file: ${fontPath}, skipping`)
      continue
    }

    console.log(`  • ${descriptor.family} ${descriptor.slug}`)

    const fontBuffer = fs.readFileSync(fontPath)
    const font = opentype.parse(fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength))

    const output = buildFontAsset(font, descriptor)
    const familySlug = descriptor.family.toLowerCase().replace(/\s+/g, '-')
    const styleSlug = descriptor.italic ? 'italic' : descriptor.slug
    const outputDir = path.join(OUTPUT_DIR, familySlug)
    ensureDirectory(outputDir)

    const dataPath = path.join(outputDir, `${styleSlug}.json`)
    fs.writeFileSync(dataPath, JSON.stringify(output, null, 2))

    manifestEntries.push({
      family: descriptor.family,
      weight: descriptor.weight,
      italic: descriptor.italic,
      style: descriptor.italic ? 'italic' : 'normal',
      data: toPublicPath(path.relative(PUBLIC_DIR, dataPath)),
    })
  }

  manifestEntries.sort((a, b) => {
    const familyCompare = a.family.localeCompare(b.family)
    if (familyCompare !== 0) return familyCompare
    if (a.weight !== b.weight) return a.weight - b.weight
    if (a.italic !== b.italic) return a.italic ? 1 : -1
    return 0
  })

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        entries: manifestEntries,
      },
      null,
      2,
    ),
  )

  console.log(`[vector-fonts] manifest written to ${manifestPath}`)
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function buildDefaultCharset() {
  const codes = new Set()
  ;[9, 10, 13].forEach((value) => codes.add(value))
  for (let code = 32; code <= 126; code += 1) {
    codes.add(code)
  }
  for (let code = 160; code <= 255; code += 1) {
    codes.add(code)
  }
  return [...codes]
}

function buildFontAsset(font, descriptor) {
  const unitsPerEm = font.unitsPerEm || 1000
  const ascender = font.ascender ?? 0
  const descender = font.descender ?? 0
  const lineGap = font.tables?.hhea?.lineGap ?? font.tables?.os2?.sTypoLineGap ?? 0
  const underlinePosition = font.tables?.post?.underlinePosition ?? -100
  const underlineThickness = font.tables?.post?.underlineThickness ?? 50
  const capHeight = font.tables?.os2?.sCapHeight ?? null
  const xHeight = font.tables?.os2?.sxHeight ?? null

  const glyphs = {}

  for (const code of DEFAULT_CHARSET) {
    const glyph = font.charToGlyph(String.fromCodePoint(code))
    if (!glyph) continue

    const glyphData = buildGlyphData(glyph, unitsPerEm)
    glyphs[String(code)] = glyphData
  }

  const kerning = buildKerningMap(font, glyphs)

  return {
    version: 1,
    family: descriptor.family,
    weight: descriptor.weight,
    italic: descriptor.italic,
    style: descriptor.italic ? 'italic' : 'normal',
    metrics: {
      unitsPerEm,
      ascender,
      descender,
      lineGap,
      lineHeight: ascender - descender + lineGap,
      underlinePosition,
      underlineThickness,
      capHeight,
      xHeight,
    },
    glyphs,
    kerning,
    charset: Object.keys(glyphs).map((key) => Number.parseInt(key, 10)),
    quality: QUALITY,
  }
}

function buildGlyphData(glyph, unitsPerEm) {
  const unicode = glyph.unicode ?? null
  const advanceWidth = glyph.advanceWidth ?? unitsPerEm / 2
  const leftSideBearing = glyph.leftSideBearing ?? 0

  const bounds = glyph.getBoundingBox()
  const hasBounds = Number.isFinite(bounds.x1) && Number.isFinite(bounds.y1) && Number.isFinite(bounds.x2) && Number.isFinite(bounds.y2)
  const minX = hasBounds ? bounds.x1 : 0
  const maxX = hasBounds ? bounds.x2 : 0
  const minY = hasBounds ? -bounds.y2 : 0
  const maxY = hasBounds ? -bounds.y1 : 0

  const geometry = buildGlyphGeometry(glyph, unitsPerEm)

  return {
    unicode,
    advanceWidth,
    leftSideBearing,
    bounds: {
      minX,
      maxX,
      minY,
      maxY,
    },
    geometry,
  }
}

function buildGlyphGeometry(glyph, unitsPerEm) {
  const path = glyph.getPath(0, 0, unitsPerEm)
  if (!path?.commands?.length) {
    return {
      positions: [],
      indices: [],
    }
  }

  const graphicsPath = new GraphicsPath()
  graphicsPath.checkForHoles = true

  for (const command of path.commands) {
    switch (command.type) {
      case 'M':
        graphicsPath.moveTo(command.x, -command.y)
        break
      case 'L':
        graphicsPath.lineTo(command.x, -command.y)
        break
      case 'Q':
        graphicsPath.quadraticCurveTo(command.x1, -command.y1, command.x, -command.y, QUALITY)
        break
      case 'C':
        graphicsPath.bezierCurveTo(
          command.x1,
          -command.y1,
          command.x2,
          -command.y2,
          command.x,
          -command.y,
          QUALITY,
        )
        break
      case 'Z':
        graphicsPath.closePath()
        break
      default:
        break
    }
  }

  const geometry = buildGeometryFromPath(graphicsPath)

  const positions = Array.from(geometry.positions ?? [])
  const indices = Array.from(geometry.indices ?? [])

  geometry.destroy()

  return {
    positions,
    indices,
  }
}

function buildKerningMap(font, glyphs) {
  const kerning = {}
  const charset = new Set(Object.keys(glyphs).map((key) => Number.parseInt(key, 10)))
  const pairTable = font.kerningPairs ?? {}

  for (const [pair, value] of Object.entries(pairTable)) {
    if (!pair) continue
    const [leftChar, rightChar] = [...pair]
    if (!leftChar || !rightChar) continue
    const leftCode = leftChar.codePointAt(0)
    const rightCode = rightChar.codePointAt(0)
    if (!charset.has(leftCode) || !charset.has(rightCode)) continue
    if (!value) continue
    const leftKey = String(leftCode)
    if (!kerning[leftKey]) {
      kerning[leftKey] = {}
    }
    kerning[leftKey][String(rightCode)] = value
  }

  return kerning
}

function toPublicPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

main().catch((error) => {
  console.error('[vector-fonts] generation failed', error)
  process.exitCode = 1
})
