import type { Vec2 } from '../../state/scene'

const DEFAULT_NORMALIZE_FACTOR = 2
const DEFAULT_MIN_MANTISSA = 0.5
const DEFAULT_MAX_MANTISSA = 4
const DEFAULT_TRANSLATION_LIMIT = 10_000

export interface CameraNormalizerOptions {
  normalizeFactor?: number
  minMantissa?: number
  maxMantissa?: number
  translationLimit?: number
}

export class CameraNormalizer {
  private readonly normalizeFactor: number
  private readonly minMantissa: number
  private readonly maxMantissa: number
  private readonly translationLimit: number

  private mantissaScale: number
  private scaleExponent: number
  private origin: Vec2
  private scenePosition: Vec2

  constructor(initialScale = 1, initialPosition: Vec2 = { x: 0, y: 0 }, options: CameraNormalizerOptions = {}) {
    this.normalizeFactor = options.normalizeFactor ?? DEFAULT_NORMALIZE_FACTOR
    this.minMantissa = options.minMantissa ?? DEFAULT_MIN_MANTISSA
    this.maxMantissa = options.maxMantissa ?? DEFAULT_MAX_MANTISSA
    this.translationLimit = options.translationLimit ?? DEFAULT_TRANSLATION_LIMIT

    this.scaleExponent = 0
    this.mantissaScale = Math.max(initialScale, Number.EPSILON)
    this.origin = { x: 0, y: 0 }
    this.scenePosition = { ...initialPosition }

    this.normalizeScale()
    this.normalizeTranslation()
  }

  getSceneScale(): number {
    return this.mantissaScale * this.getScaleFactor()
  }

  /** @deprecated Prefer getSceneScale for clarity */
  getEffectiveScale(): number {
    return this.getSceneScale()
  }

  getRenderScale(): number {
    return this.mantissaScale
  }

  getSceneScaleFactor(): number {
    return this.getScaleFactor()
  }

  getScaleExponent(): number {
    return this.scaleExponent
  }

  getOrigin(): Vec2 {
    return { ...this.origin }
  }

  getScenePosition(): Vec2 {
    return { ...this.scenePosition }
  }

  getRenderTranslation(): Vec2 {
    const sceneScale = this.getSceneScale()
    return {
      x: this.scenePosition.x + sceneScale * this.origin.x,
      y: this.scenePosition.y + sceneScale * this.origin.y,
    }
  }

  setSceneScale(scale: number) {
    this.mantissaScale = Math.max(scale, Number.EPSILON)
    this.scaleExponent = 0
    this.normalizeScale()
    this.normalizeTranslation()
  }

  multiplySceneScale(multiplier: number) {
    if (!Number.isFinite(multiplier) || multiplier === 0) {
      return
    }
    this.mantissaScale *= multiplier
    this.normalizeScale()
    this.normalizeTranslation()
  }

  setScenePosition(position: Vec2) {
    this.scenePosition = { ...position }
    this.normalizeTranslation()
  }

  translateScene(delta: Vec2) {
    this.scenePosition = {
      x: this.scenePosition.x + delta.x,
      y: this.scenePosition.y + delta.y,
    }
    this.normalizeTranslation()
  }

  sceneToRender(point: Vec2): Vec2 {
    const scaleFactor = this.getScaleFactor()
    return {
      x: (point.x - this.origin.x) * scaleFactor,
      y: (point.y - this.origin.y) * scaleFactor,
    }
  }

  lengthToRender(value: number): number {
    return value * this.getScaleFactor()
  }

  renderToScene(point: Vec2): Vec2 {
    const scaleFactor = this.getScaleFactor()
    if (scaleFactor === 0) {
      return { ...this.origin }
    }
    return {
      x: point.x / scaleFactor + this.origin.x,
      y: point.y / scaleFactor + this.origin.y,
    }
  }

  private getScaleFactor(): number {
    return this.normalizeFactor ** this.scaleExponent
  }

  private normalizeScale() {
    const factor = this.normalizeFactor
    while (this.mantissaScale >= this.maxMantissa) {
      this.mantissaScale /= factor
      this.scaleExponent += 1
    }
    while (this.mantissaScale < this.minMantissa) {
      this.mantissaScale *= factor
      this.scaleExponent -= 1
    }
  }

  private normalizeTranslation() {
    const limit = this.translationLimit
    const maxRender = limit * 0.5
    const sceneScale = Math.max(this.getSceneScale(), Number.EPSILON)

    const clampAxis = (axis: 'x' | 'y') => {
      let renderValue = this.scenePosition[axis] + sceneScale * this.origin[axis]
      if (renderValue > maxRender) {
        const delta = (Math.floor((renderValue - maxRender) / limit) + 1) * (limit / sceneScale)
        this.origin[axis] -= delta
        renderValue -= delta * sceneScale
      } else if (renderValue < -maxRender) {
        const delta = (Math.floor((-renderValue - maxRender) / limit) + 1) * (limit / sceneScale)
        this.origin[axis] += delta
        renderValue += delta * sceneScale
      }
    }

    clampAxis('x')
    clampAxis('y')
  }
}
