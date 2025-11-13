import { describe, expect, it } from 'vitest'

import { CameraNormalizer } from './cameraNormalizer'

describe('CameraNormalizer', () => {
  it('keeps mantissa within bounds by adjusting exponent upward', () => {
    const camera = new CameraNormalizer(256)
    expect(camera.getRenderScale()).toBeGreaterThanOrEqual(0.5)
    expect(camera.getRenderScale()).toBeLessThan(4)
    expect(camera.getScaleExponent()).toBeGreaterThan(0)
    const effective = camera.getSceneScale()
    expect(Math.abs(effective - 256)).toBeLessThan(1e-6)
  })

  it('adjusts exponent downward for tiny scales', () => {
    const camera = new CameraNormalizer(1 / 4096)
    expect(camera.getRenderScale()).toBeGreaterThanOrEqual(0.5)
    expect(camera.getScaleExponent()).toBeLessThan(0)
    const effective = camera.getSceneScale()
    expect(Math.abs(effective - 1 / 4096)).toBeLessThan(1e-9)
  })

  it('converts between scene and render space without loss', () => {
    const camera = new CameraNormalizer(64, { x: 10_000, y: -5_000 })
    const point = { x: 12_345.678, y: -9_876.543 }
    const renderPoint = camera.sceneToRender(point)
    const reconstructed = camera.renderToScene(renderPoint)
    expect(reconstructed.x).toBeCloseTo(point.x, 10)
    expect(reconstructed.y).toBeCloseTo(point.y, 10)
  })

  it('converts scalar lengths into render space', () => {
    const camera = new CameraNormalizer(1, undefined, { normalizeFactor: 2 })
    camera.multiplySceneScale(1 / 64)
    const sceneLength = 128
    const renderLength = camera.lengthToRender(sceneLength)
    const roundTrip = renderLength / camera.getSceneScaleFactor()
    expect(roundTrip).toBeCloseTo(sceneLength, 6)
  })

  it('recenters translation when exceeding limit', () => {
    const translationLimit = 10_000
    const camera = new CameraNormalizer(1, { x: 0, y: 0 }, { translationLimit })
    camera.setScenePosition({ x: translationLimit * 50, y: translationLimit * -60 })

    const render = camera.getRenderTranslation()
    expect(Math.abs(render.x)).toBeLessThanOrEqual(translationLimit)
    expect(Math.abs(render.y)).toBeLessThanOrEqual(translationLimit)

    const origin = camera.getOrigin()
    expect(origin.x).not.toBe(0)
    expect(origin.y).not.toBe(0)
  })
})
