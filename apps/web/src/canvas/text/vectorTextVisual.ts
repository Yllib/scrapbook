import { Container, Graphics, Mesh, MeshGeometry, Texture } from 'pixi.js'

import { ensureGlyphMeshGeometry, type VectorFont } from './vectorFont'
import type { LayoutBounds, VectorTextLayout } from './vectorTextLayout'

type GlyphRenderEntry = {
  x: number
  y: number
  geometry: MeshGeometry
}

type VectorTextStroke = {
  color: number
  width: number
} | null

export class VectorTextVisual {
  readonly container: Container
  private readonly glyphContainer: Container
  private readonly strokeGraphics: Graphics
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

    this.strokeGraphics = new Graphics()
    this.strokeGraphics.eventMode = 'none'
    this.strokeGraphics.visible = false

    this.glyphContainer = new Container()
    this.glyphContainer.eventMode = 'none'
    this.glyphContainer.sortableChildren = false
    this.container.addChild(this.strokeGraphics)
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
    this.strokeGraphics.clear()
    this.strokeGraphics.visible = false
  }

  update(font: VectorFont, layout: VectorTextLayout, color: number, stroke: VectorTextStroke) {
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

    this.updateStroke(layout, stroke)
  }

  private updateStroke(layout: VectorTextLayout, stroke: VectorTextStroke) {
    const graphics = this.strokeGraphics
    graphics.clear()
    graphics.visible = false

    if (!stroke || stroke.width <= 0) {
      return
    }

    const layoutScale = layout.scale
    if (!(layoutScale > 0)) {
      return
    }

    const strokeWidthUnits = stroke.width / layoutScale
    if (!Number.isFinite(strokeWidthUnits) || strokeWidthUnits <= 0) {
      return
    }

    graphics.scale.set(layoutScale, -layoutScale)
    graphics.position.set(0, 0)

    let drewPath = false

    for (const line of layout.lines) {
      for (const placement of line.glyphs) {
        const glyph = placement.glyph
        if (!glyph.contours || glyph.contours.length === 0) {
          continue
        }
        const offsetX = placement.x / layoutScale
        const offsetY = -placement.y / layoutScale
        for (const contour of glyph.contours) {
          for (const command of contour) {
            switch (command.type) {
              case 'moveTo':
                graphics.moveTo(offsetX + command.x, offsetY + command.y)
                drewPath = true
                break
              case 'lineTo':
                graphics.lineTo(offsetX + command.x, offsetY + command.y)
                drewPath = true
                break
              case 'quadraticCurveTo':
                graphics.quadraticCurveTo(
                  offsetX + command.x1,
                  offsetY + command.y1,
                  offsetX + command.x,
                  offsetY + command.y,
                )
                drewPath = true
                break
              case 'bezierCurveTo':
                graphics.bezierCurveTo(
                  offsetX + command.x1,
                  offsetY + command.y1,
                  offsetX + command.x2,
                  offsetY + command.y2,
                  offsetX + command.x,
                  offsetY + command.y,
                )
                drewPath = true
                break
              case 'closePath':
                graphics.closePath()
                break
              default:
                break
            }
          }
        }
      }
    }

    if (!drewPath) {
      graphics.clear()
      graphics.visible = false
      return
    }

    graphics.stroke({
      width: strokeWidthUnits,
      color: stroke.color,
      alpha: 1,
      join: 'round',
      cap: 'round',
    })
    graphics.visible = true
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
