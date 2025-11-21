import { describe, expect, it } from 'vitest'

import {
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  ZOOM_PRECISION_TOLERANCE,
  ZOOM_REFERENCE_TRANSLATION,
  ZOOM_REFERENCE_WORLD_SIZE,
  computePrecisionError,
  estimateMaxSafeScale,
  estimateMinSafeScale,
} from './zoomLimits'

describe('viewport zoom limits', () => {
  it('keeps the minimum scale inside the precision window', () => {
    const measured = estimateMinSafeScale()
    expect(MIN_VIEWPORT_SCALE).toBeCloseTo(measured, 12)

    const safeError = computePrecisionError(MIN_VIEWPORT_SCALE)
    expect(safeError).toBeLessThanOrEqual(ZOOM_PRECISION_TOLERANCE)

    const unsafeError = computePrecisionError(MIN_VIEWPORT_SCALE / 2)
    expect(unsafeError).toBeGreaterThan(ZOOM_PRECISION_TOLERANCE)
  })

  it('keeps the maximum scale under the integer precision budget', () => {
    const measured = estimateMaxSafeScale()
    expect(MAX_VIEWPORT_SCALE).toBeCloseTo(measured, 12)

    const combined = (ZOOM_REFERENCE_WORLD_SIZE + ZOOM_REFERENCE_TRANSLATION) * MAX_VIEWPORT_SCALE
    expect(combined).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)

    const overflow = (ZOOM_REFERENCE_WORLD_SIZE + ZOOM_REFERENCE_TRANSLATION) * (MAX_VIEWPORT_SCALE * 2)
    expect(overflow).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })
})
