declare module 'msdfgen-wasm' {
  export type MsdfOptions = {
    size: number
    range: number
    scanline?: boolean
    edgeColoring?: 'simple' | 'inktrap' | 'distance'
    edgeThresholdAngle?: number
  }

  export type AtlasOptions = {
    maxWidth: number
    maxHeight: number
    padding: number
    pot?: boolean
    smart?: boolean
    allowRotation?: boolean
    [key: string]: unknown
  }

  export type FontMetrics = {
    emSize: number
    ascenderY: number
    descenderY: number
    lineHeight: number
    underlineY: number
    underlineThickness: number
    spaceAdvance: number
    tabAdvance: number
  }

  export type Glyph = {
    unicode: number
    index: number
    advance: number
    left: number
    bottom: number
    right: number
    top: number
    kerning: Array<[Glyph, number]>
  }

  export type PackedGlyphRectangle = {
    x: number
    y: number
    width: number
    height: number
    rot: boolean
    oversized: boolean
    glyph: Glyph
    msdfData: {
      scale: number
      xTranslate: number
      yTranslate: number
      range: number
      edgeColoring: 'simple' | 'inktrap' | 'distance'
      edgeThresholdAngle: number
      width: number
      height: number
      scanline: boolean
    }
  }

  export type PackedGlyphsBin = {
    width: number
    height: number
    rects: PackedGlyphRectangle[]
  }

  export class Msdfgen {
    static create(wasm: ArrayBufferLike): Promise<Msdfgen>

    loadFont(data: Uint8Array, characters?: number[]): void
    loadGlyphs(characters: number[], options?: { preprocess: boolean }): void
    packGlyphs(msdfOptions: MsdfOptions, atlasOptions: AtlasOptions, glyphs?: Glyph[]): PackedGlyphsBin[]
    createAtlasImage(bin: PackedGlyphsBin): Uint8Array<ArrayBuffer>
    readonly metrics: FontMetrics
  }
}

declare module 'msdfgen-wasm/wasm?url' {
  const url: string
  export default url
}
