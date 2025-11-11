import { Assets, BitmapFont, Cache, Texture } from 'pixi.js'
import { extractPrimaryFamily, parseFontWeight, fontBucket, hashKey, type FontStyleDescriptor, type MsdfFontDescriptor, type BitmapFontDataLike } from './msdfCommon'

type MsdfFontAtlas = {
  name: string
  baseSize: number
}

type PrebuiltManifestEntry = {
  family: string
  weight: number
  italic: boolean
  bucket: number
  fontName: string
  data: string
}

type PrebuiltManifest = {
  entries: PrebuiltManifestEntry[]
}

type WorkerGenerateRequest = {
  id: number
  type: 'generate'
  descriptor: MsdfFontDescriptor
  fontBuffer: ArrayBuffer
}

type WorkerGenerateResponse =
  | {
      id: number
      type: 'generated'
      fontName: string
      fontData: BitmapFontDataLike
      pngs: ArrayBuffer[]
    }
  | {
      id: number
      type: 'error'
      error: string
    }

const PREBUILT_MANIFEST_URL = '/msdf/manifest.json'

const fontFileCache = new Map<string, Promise<Uint8Array>>()
const atlasCache = new Map<string, Promise<MsdfFontAtlas>>()

let prebuiltManifestPromise: Promise<Map<string, PrebuiltManifestEntry> | null> | null = null
let worker: Worker | null = null
let workerRequestId = 0
const workerPending = new Map<number, { resolve: (message: WorkerGenerateResponse) => void; reject: (error: unknown) => void }>()

export async function resolveMsdfFont(style: FontStyleDescriptor): Promise<MsdfFontAtlas> {
  const descriptor: MsdfFontDescriptor = {
    family: extractPrimaryFamily(style.fontFamily),
    weight: parseFontWeight(style.fontWeight),
    italic: style.fontStyle.toLowerCase() === 'italic',
    bucket: fontBucket(style.fontSize),
  }

  const cacheKey = descriptorKey(descriptor)

  let atlasPromise = atlasCache.get(cacheKey)
  if (!atlasPromise) {
    atlasPromise = generateAtlas(descriptor).catch((error) => {
      atlasCache.delete(cacheKey)
      throw error
    })
    atlasCache.set(cacheKey, atlasPromise)
  }

  return atlasPromise
}

async function generateAtlas(descriptor: MsdfFontDescriptor): Promise<MsdfFontAtlas> {
  const prebuilt = await tryLoadPrebuiltAtlas(descriptor)
  if (prebuilt) {
    return prebuilt
  }

  const fontBuffer = await loadFontFile(descriptor.family, descriptor.weight, descriptor.italic)

  return generateAtlasWithWorker(descriptor, fontBuffer)
}

async function tryLoadPrebuiltAtlas(descriptor: MsdfFontDescriptor): Promise<MsdfFontAtlas | null> {
  const manifest = await loadPrebuiltManifest()
  if (!manifest) {
    return null
  }

  const entry = manifest.get(descriptorKey(descriptor))
  if (!entry) {
    return null
  }

  return loadPrebuiltEntry(entry, descriptor.bucket)
}

async function loadPrebuiltManifest(): Promise<Map<string, PrebuiltManifestEntry> | null> {
  if (!prebuiltManifestPromise) {
    prebuiltManifestPromise = (async () => {
      try {
        const response = await fetch(PREBUILT_MANIFEST_URL, { cache: 'force-cache' })
        if (!response.ok) {
          return null
        }
        const manifest = (await response.json()) as PrebuiltManifest
        const map = new Map<string, PrebuiltManifestEntry>()
        manifest.entries.forEach((entry) => {
          map.set(descriptorKey(entry), entry)
        })
        return map
      } catch (error) {
        console.warn('[msdf] failed to load prebuilt manifest', error)
        return null
      }
    })()
  }
  return prebuiltManifestPromise
}

async function loadPrebuiltEntry(entry: PrebuiltManifestEntry, bucket: number): Promise<MsdfFontAtlas> {
  const cacheKey = `${entry.fontName}-bitmap`
  if (Cache.has(cacheKey)) {
    return {
      name: entry.fontName,
      baseSize: bucket,
    }
  }

  const dataResponse = await fetch(entry.data, { cache: 'force-cache' })
  if (!dataResponse.ok) {
    throw new Error(`Failed to load prebuilt font data: ${entry.data}`)
  }
  const json = await dataResponse.json()
  const fontData: BitmapFontDataLike = 'fontData' in json ? json.fontData : (json as BitmapFontDataLike)

  const baseUrl = entry.data.slice(0, entry.data.lastIndexOf('/') + 1)

  const textures = await Promise.all(
    fontData.pages.map(async (page, index) => {
      const url = `${baseUrl}${page.file}`
      const texture = await Assets.load<Texture>(url)
      texture.label = `${entry.fontName}-${index}`
      texture.source.label = `${entry.fontName}-${index}`
      texture.source.style.scaleMode = 'linear'
      return texture
    }),
  )

  registerBitmapFont(entry.fontName, fontData, textures)

  return {
    name: entry.fontName,
    baseSize: bucket,
  }
}

async function generateAtlasWithWorker(descriptor: MsdfFontDescriptor, fontBuffer: Uint8Array): Promise<MsdfFontAtlas> {
  const transferBuffer = fontBuffer.slice().buffer
  const response = await postToWorker({
    id: ++workerRequestId,
    type: 'generate',
    descriptor,
    fontBuffer: transferBuffer,
  })

  if (response.type === 'error') {
    throw new Error(response.error)
  }

  const textures = await Promise.all(
    response.pngs.map((pngBuffer, index) => createTextureFromPngBuffer(pngBuffer, `${response.fontName}-${index}`)),
  )

  registerBitmapFont(response.fontName, response.fontData, textures)

  return {
    name: response.fontName,
    baseSize: descriptor.bucket,
  }
}

function registerBitmapFont(fontName: string, fontData: BitmapFontDataLike, textures: Texture[]) {
  const cacheKey = `${fontName}-bitmap`
  if (Cache.has(cacheKey)) {
    const existing = Cache.get(cacheKey) as BitmapFont | undefined
    existing?.destroy()
    Cache.remove(cacheKey)
  }

  const bitmapFont = new BitmapFont({
    data: fontData as any,
    textures,
  })
  bitmapFont.applyFillAsTint = true
  bitmapFont.fontMetrics.ascent = fontData.baseLineOffset
  bitmapFont.fontMetrics.descent = fontData.lineHeight - fontData.baseLineOffset
  bitmapFont.fontMetrics.fontSize = fontData.fontSize

  Cache.set(cacheKey, bitmapFont)
  bitmapFont.once('destroy', () => {
    if (Cache.has(cacheKey)) {
      Cache.remove(cacheKey)
    }
  })
}

async function postToWorker(message: WorkerGenerateRequest): Promise<WorkerGenerateResponse> {
  const workerInstance = ensureWorker()

  return new Promise<WorkerGenerateResponse>((resolve, reject) => {
    workerPending.set(message.id, { resolve, reject })
    workerInstance.postMessage(message, [message.fontBuffer])
  })
}

function ensureWorker(): Worker {
  if (worker) {
    return worker
  }

  worker = new Worker(new URL('./msdfWorker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<WorkerGenerateResponse>) => {
    const pending = workerPending.get(event.data.id)
    if (!pending) {
      return
    }
    workerPending.delete(event.data.id)
    pending.resolve(event.data)
  })
  worker.addEventListener('error', (event) => {
    console.error('[msdf] worker error', event)
    workerPending.forEach(({ reject }) => reject(event))
    workerPending.clear()
  })
  worker.addEventListener('messageerror', (event) => {
    console.error('[msdf] worker message error', event)
  })

  return worker
}

async function createTextureFromPngBuffer(buffer: ArrayBuffer, label: string): Promise<Texture> {
  const blob = new Blob([buffer], { type: 'image/png' })
  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await loadImageElement(objectUrl)
    const texture = Texture.from(image)
    texture.label = label
    texture.source.label = label
    texture.source.style.scaleMode = 'linear'
    return texture
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load MSDF atlas image'))
    image.src = url
  })
}

async function loadFontFile(family: string, weight: number, italic: boolean): Promise<Uint8Array> {
  const url = resolveFontAsset(family, weight, italic)
  let loader = fontFileCache.get(url)
  if (!loader) {
    loader = fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load font asset: ${url}`)
        }
        const buffer = new Uint8Array(await response.arrayBuffer())
        if (buffer.byteLength < 4) {
          throw new Error(`Font asset is empty: ${url}`)
        }
        const headerView = buffer.subarray(0, Math.min(buffer.byteLength, 32))
        const headerText = new TextDecoder('ascii', { fatal: false }).decode(headerView)
        const hasHtmlSignature =
          headerText.startsWith('<!DOCTYPE') ||
          headerText.startsWith('<html') ||
          headerText.includes('<html')
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const tag = view.getUint32(0)
        const isValidFontHeader =
          tag === 0x00010000 || // TrueType
          tag === 0x4f54544f || // 'OTTO'
          tag === 0x74727565 || // 'true'
          tag === 0x74797031 // 'typ1'
        if (hasHtmlSignature || !isValidFontHeader) {
          throw new Error(`Unexpected font file contents at ${url}`)
        }
        return buffer
      })
      .catch((error) => {
        fontFileCache.delete(url)
        throw error
      })
    fontFileCache.set(url, loader)
  }
  return loader
}

function resolveFontAsset(family: string, weight: number, italic: boolean): string {
  const normalized = family.trim().toLowerCase()
  if (normalized === 'inter') {
    if (italic) return '/fonts/Inter-Italic.ttf'
    if (weight >= 600) return '/fonts/Inter-Bold.ttf'
    return '/fonts/Inter-Regular.ttf'
  }
  return '/fonts/Inter-Regular.ttf'
}

function descriptorKey(descriptor: MsdfFontDescriptor | PrebuiltManifestEntry): string {
  return `${descriptor.family}|${descriptor.weight}|${descriptor.italic ? 'italic' : 'normal'}|${descriptor.bucket}`
}

export function makeFontName(descriptor: MsdfFontDescriptor): string {
  return `msdf-${hashKey(`${descriptor.family}-${descriptor.weight}-${descriptor.italic}-${descriptor.bucket}`)}`
}

export type { FontStyleDescriptor, MsdfFontAtlas, BitmapFontDataLike }
