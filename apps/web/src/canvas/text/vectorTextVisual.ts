import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js'

import { ensureGlyphMeshGeometry, type VectorFont } from './vectorFont'
import type { LayoutBounds, VectorTextLayout } from './vectorTextLayout'

type GlyphRenderEntry = {
  x: number
  y: number
  geometry: MeshGeometry
}

export class VectorTextVisual {
  readonly container: Container
  private readonly glyphContainer: Container
  private glyphMeshes: Mesh[] = []
  private _layout: VectorTextLayout | null = null
  private _bounds: LayoutBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  private _font: VectorFont | null = null
  private currentColor = 0xffffff

  constructor() {
    this.container = new Container()
    this.container.label = 'VectorText'
    this.container.eventMode = 'none'
    this.container.sortableChildren = false

    this.glyphContainer = new Container()
    this.glyphContainer.eventMode = 'none'
    this.glyphContainer.sortableChildren = false
    this.container.addChild(this.glyphContainer)
  }

  get layout(): VectorTextLayout | null {
    return this._layout
  }

  get bounds(): LayoutBounds {
    return this._bounds
  }

  get font(): VectorFont | null {
    return this._font
  }

  get color(): number {
    return this.currentColor
  }

  clear() {
    this._layout = null
    this._font = null
    this._bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
    for (const mesh of this.glyphMeshes) {
      mesh.visible = false
    }
  }

  update(font: VectorFont, layout: VectorTextLayout, color: number) {
    this._font = font
    this._layout = layout
    this._bounds = layout.bounds
    this.currentColor = color

    const entries: GlyphRenderEntry[] = []

    for (const line of layout.lines) {
      for (const placement of line.glyphs) {
        const geometry = ensureGlyphMeshGeometry(placement.glyph)
        if (!geometry) continue
        entries.push({
          x: placement.x,
          y: placement.y,
          geometry,
        })
      }
    }

    ensureGlyphMeshCapacity(this.glyphContainer, this.glyphMeshes, entries)

    for (let index = 0; index < this.glyphMeshes.length; index += 1) {
      const mesh = this.glyphMeshes[index]
      const entry = entries[index]
      if (!entry) {
        mesh.visible = false
        continue
      }
      mesh.visible = true
      mesh.geometry = entry.geometry
      mesh.texture = Texture.WHITE
      mesh.tint = color
      mesh.position.set(entry.x, entry.y)
      mesh.scale.set(layout.scale, -layout.scale)
    }
  }
}

function ensureGlyphMeshCapacity(parent: Container, meshes: Mesh[], entries: GlyphRenderEntry[]) {
  for (let index = meshes.length; index < entries.length; index += 1) {
    const entry = entries[index]
    const mesh = new Mesh({
      geometry: entry?.geometry ?? emptyGeometry(),
      texture: Texture.WHITE,
    })
    mesh.eventMode = 'none'
    mesh.visible = false
    parent.addChild(mesh)
    meshes.push(mesh)
  }

  for (let index = meshes.length - 1; index >= entries.length; index -= 1) {
    meshes[index].visible = false
  }
}

let cachedEmptyGeometry: MeshGeometry | null = null

function emptyGeometry(): MeshGeometry {
  if (!cachedEmptyGeometry) {
    cachedEmptyGeometry = new MeshGeometry({
      positions: new Float32Array(),
      uvs: new Float32Array(),
      indices: new Uint32Array(),
    })
  }
  return cachedEmptyGeometry
}
