import { Msdfgen } from 'msdfgen-wasm'
import type { AtlasOptions, MsdfOptions } from 'msdfgen-wasm'
import wasmUrl from 'msdfgen-wasm/wasm?url'
import {
  DEFAULT_CHARSET,
  buildBitmapFontData,
  hashKey,
  type MsdfFontDescriptor,
  type BitmapFontDataLike,
} from './msdfCommon'

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

const ctx = self

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
let msdfgenPromise: Promise<Msdfgen> | null = null

ctx.onmessage = async (event: MessageEvent<WorkerGenerateRequest>) => {
  const message = event.data
  if (message.type !== 'generate') {
    return
  }

  try {
    const msdfgen = await getMsdfgenInstance()
    const fontBuffer = new Uint8Array(message.fontBuffer)

    msdfgen.loadFont(fontBuffer, DEFAULT_CHARSET)
    msdfgen.loadGlyphs(DEFAULT_CHARSET, { preprocess: true })

    const descriptor = message.descriptor

    const msdfOptions: MsdfOptions = {
      size: descriptor.bucket,
      range: Math.max(12, Math.round(descriptor.bucket * 0.25)),
      edgeColoring: 'simple',
      edgeThresholdAngle: 3,
    }

    const atlasOptions: AtlasOptions = {
      maxWidth: Math.min(4096, descriptor.bucket * 2),
      maxHeight: Math.min(4096, descriptor.bucket * 2),
      padding: 4,
      pot: true,
      smart: true,
      allowRotation: false,
    }

    const bins = msdfgen.packGlyphs(msdfOptions, atlasOptions)
    const fontName = `msdf-${hashKey(
      `${descriptor.family}-${descriptor.weight}-${descriptor.italic}-${descriptor.bucket}`,
    )}`

    const fontData = buildBitmapFontData({
      fontName,
      family: descriptor.family,
      msdfOptions,
      bins,
      metrics: msdfgen.metrics,
    })

    const pngs: ArrayBuffer[] = []
    const transfer: ArrayBuffer[] = []
    bins.forEach((bin) => {
      const png = msdfgen.createAtlasImage(bin)
      const sliced = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
      pngs.push(sliced)
      transfer.push(sliced)
    })

    const response: WorkerGenerateResponse = {
      id: message.id,
      type: 'generated',
      fontName,
      fontData,
      pngs,
    }

    ;(ctx as any).postMessage(response, transfer)
  } catch (error) {
    const response: WorkerGenerateResponse = {
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
    ;(ctx as any).postMessage(response)
  }
}

async function getMsdfgenInstance(): Promise<Msdfgen> {
  if (!msdfgenPromise) {
    msdfgenPromise = (async () => {
      const binary = await loadWasmBinary()
      return Msdfgen.create(binary)
    })()
  }
  return msdfgenPromise
}

async function loadWasmBinary(): Promise<ArrayBuffer> {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = (async () => {
      const response = await fetch(wasmUrl)
      if (!response.ok) {
        throw new Error('Failed to load MSDF wasm module')
      }
      return response.arrayBuffer()
    })()
  }
  return wasmBinaryPromise
}
