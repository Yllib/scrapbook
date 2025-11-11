#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT_DIR, 'public')
const FONT_DIR = path.join(PUBLIC_DIR, 'fonts')
const OUTPUT_DIR = path.join(PUBLIC_DIR, 'msdf')
const DEFAULT_CHARSET = buildDefaultCharset()

const bucketArg = process.argv.find((arg) => arg.startsWith('--bucket='))
const BUCKETS = bucketArg ? [Number.parseInt(bucketArg.split('=')[1], 10)] : [64, 128, 256, 512, 1024]

const DESCRIPTORS = [
  { family: 'Inter', weight: 400, italic: false, file: 'Inter-Regular.ttf', slug: 'regular' },
  { family: 'Inter', weight: 700, italic: false, file: 'Inter-Bold.ttf', slug: 'bold' },
  { family: 'Inter', weight: 400, italic: true, file: 'Inter-Italic.ttf', slug: 'italic' },
]

async function main() {
  console.log('[msdf] generating prebuilt fonts...')

  ensureDirectory(OUTPUT_DIR)

  const { msdfgenPackageRoot, Msdfgen } = await loadMsdfgenModule()
  const wasmPath = resolveWasmPath(msdfgenPackageRoot)
  const wasmBinary = fs.readFileSync(wasmPath)
  const msdfgen = await Msdfgen.create(wasmBinary)

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json')
  const manifestMap = loadExistingManifest(manifestPath)

  for (const descriptor of DESCRIPTORS) {
    console.log(`  • ${descriptor.family} ${descriptor.slug}`)
    const fontPath = path.join(FONT_DIR, descriptor.file)
    const fontBuffer = fs.readFileSync(fontPath)

    msdfgen.loadFont(fontBuffer, DEFAULT_CHARSET)
    msdfgen.loadGlyphs(DEFAULT_CHARSET, { preprocess: true })

    const familySlug = descriptor.family.toLowerCase().replace(/\s+/g, '-')
    const styleSlug = descriptor.italic ? 'italic' : descriptor.slug
    const familyDir = path.join(OUTPUT_DIR, familySlug, styleSlug)
    ensureDirectory(familyDir)

    for (const bucket of BUCKETS) {
      const fontDescriptor = {
        family: descriptor.family,
        weight: descriptor.weight,
        italic: descriptor.italic,
        bucket,
      }

      const fontName = makeFontName(fontDescriptor)

      const msdfOptions = {
        size: bucket,
        range: Math.max(12, Math.round(bucket * 0.25)),
        edgeColoring: 'simple',
        edgeThresholdAngle: 3,
      }

      const atlasOptions = {
        maxWidth: Math.min(4096, bucket * 2),
        maxHeight: Math.min(4096, bucket * 2),
        padding: 4,
        pot: true,
        smart: true,
        allowRotation: false,
      }

      const bins = msdfgen.packGlyphs(msdfOptions, atlasOptions)
      const fontData = buildBitmapFontData({
        fontName,
        family: descriptor.family,
        msdfOptions,
        bins,
        metrics: msdfgen.metrics,
      })

      const bucketDir = path.join(familyDir, String(bucket))
      fs.rmSync(bucketDir, { recursive: true, force: true })
      ensureDirectory(bucketDir)

      const pageFiles = []
      bins.forEach((bin, index) => {
        const png = msdfgen.createAtlasImage(bin)
        const fileName = `${fontName}_page_${index}.png`
        fs.writeFileSync(path.join(bucketDir, fileName), png)
        pageFiles.push(fileName)
      })

      fontData.pages.forEach((page, index) => {
        page.file = pageFiles[index]
      })

      const dataPath = path.join(bucketDir, 'font.json')
      fs.writeFileSync(
        dataPath,
        JSON.stringify(
          {
            fontData,
          },
          null,
          2,
        ),
      )

      manifestMap.set(manifestKey(fontDescriptor), {
        family: descriptor.family,
        weight: descriptor.weight,
        italic: descriptor.italic,
        bucket,
        fontName,
        data: toPublicPath(path.relative(PUBLIC_DIR, dataPath)),
      })
    }
  }

  const manifestEntries = Array.from(manifestMap.values()).sort((a, b) => {
    const familyCompare = a.family.localeCompare(b.family)
    if (familyCompare !== 0) return familyCompare
    if (a.weight !== b.weight) return a.weight - b.weight
    if (a.italic !== b.italic) return a.italic ? 1 : -1
    return a.bucket - b.bucket
  })

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        entries: manifestEntries,
      },
      null,
      2,
    ),
  )

  console.log(`[msdf] manifest written to ${manifestPath}`)
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function buildDefaultCharset() {
  const codes = new Set()
  ;[9, 10, 13].forEach((code) => codes.add(code))
  for (let code = 32; code <= 126; code += 1) {
    codes.add(code)
  }
  for (let code = 160; code <= 255; code += 1) {
    codes.add(code)
  }
  return [...codes]
}

function hashKey(value) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

function makeFontName(descriptor) {
  return `msdf-${hashKey(`${descriptor.family}-${descriptor.weight}-${descriptor.italic}-${descriptor.bucket}`)}`
}

function buildBitmapFontData(params) {
  const { fontName, family, msdfOptions, bins, metrics } = params
  const round = (value) => Math.round(value * msdfOptions.size * 100) / 100
  const chars = {}

  bins.forEach((bin, pageIndex) => {
    for (const rect of bin.rects) {
      const glyph = rect.glyph
      const range = rect.msdfData.range
      const hasSize = rect.width > 0 && rect.height > 0
      const letter = String.fromCodePoint(glyph.unicode)
      const kerning = {}

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

  const pages = bins.map((_, index) => ({
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

function toPublicPath(relativePath) {
  return `/${relativePath.replace(/\\\\/g, '/').replace(/\\/g, '/')}`
}

function loadExistingManifest(manifestPath) {
  const map = new Map()
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      existing.entries.forEach((entry) => {
        map.set(manifestKey(entry), entry)
      })
    } catch (error) {
      console.warn('[msdf] failed to read existing manifest, regenerating', error)
    }
  }
  return map
}

function manifestKey(descriptor) {
  return `${descriptor.family}|${descriptor.weight}|${descriptor.italic ? 'italic' : 'normal'}|${descriptor.bucket}`
}

async function loadMsdfgenModule() {
  const entryPath = fileURLToPath(await import.meta.resolve('msdfgen-wasm'))
  const esmDir = path.dirname(entryPath)
  const distDir = path.dirname(esmDir)
  const packageRoot = path.dirname(distDir)
  const modulePath = path.join(packageRoot, 'dist', 'cjs', 'index.js')
  const MsdfgenModule = await import(pathToFileURL(modulePath).href)
  return { msdfgenPackageRoot: packageRoot, Msdfgen: MsdfgenModule.Msdfgen }
}

function resolveWasmPath(packageRoot) {
  const direct = path.join(packageRoot, 'wasm', 'msdfgen.wasm')
  if (fs.existsSync(direct)) {
    return direct
  }
  return path.join(packageRoot, 'dist', 'wasm', 'msdfgen.wasm')
}

main().catch((error) => {
  console.error('[msdf] generation failed', error)
  process.exitCode = 1
})
