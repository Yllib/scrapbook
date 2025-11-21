export const ZOOM_PRECISION_TOLERANCE = 0.25
export const ZOOM_REFERENCE_WORLD_SIZE = 100_000
export const ZOOM_REFERENCE_TRANSLATION = 100_000

export function computePrecisionError(
  scale: number,
  world = ZOOM_REFERENCE_WORLD_SIZE,
  translation = ZOOM_REFERENCE_TRANSLATION,
): number {
  if (!Number.isFinite(scale) || scale === 0) {
    return Number.POSITIVE_INFINITY
  }
  const screenValue = world * scale + translation
  if (!Number.isFinite(screenValue)) {
    return Number.POSITIVE_INFINITY
  }
  const recovered = (screenValue - translation) / scale
  return Math.abs(recovered - world)
}

export function isPrecisionSafe(
  scale: number,
  world = ZOOM_REFERENCE_WORLD_SIZE,
  translation = ZOOM_REFERENCE_TRANSLATION,
  tolerance = ZOOM_PRECISION_TOLERANCE,
): boolean {
  return computePrecisionError(scale, world, translation) <= tolerance
}

export function estimateMinSafeScale(
  world = ZOOM_REFERENCE_WORLD_SIZE,
  translation = ZOOM_REFERENCE_TRANSLATION,
  tolerance = ZOOM_PRECISION_TOLERANCE,
): number {
  let low = 0
  let high = 1

  while (!isPrecisionSafe(high, world, translation, tolerance)) {
    low = high
    high *= 2
    if (!Number.isFinite(high)) {
      return Number.POSITIVE_INFINITY
    }
  }

  for (let i = 0; i < 128; i += 1) {
    const mid = (low + high) / 2
    if (isPrecisionSafe(mid, world, translation, tolerance)) {
      high = mid
    } else {
      low = mid
    }
  }

  return high
}

export function estimateMaxSafeScale(
  world = ZOOM_REFERENCE_WORLD_SIZE,
  translation = ZOOM_REFERENCE_TRANSLATION,
): number {
  const span = world + translation
  if (!Number.isFinite(span) || span <= 0) {
    return Number.MAX_SAFE_INTEGER
  }
  return Number.MAX_SAFE_INTEGER / span
}

export const MIN_VIEWPORT_SCALE = estimateMinSafeScale()
export const MAX_VIEWPORT_SCALE = estimateMaxSafeScale()

export const UI_MIN_SCALE = 0.001
export const UI_MAX_SCALE = 10_000

export const ZOOM_LIMITS = {
  min: MIN_VIEWPORT_SCALE,
  max: MAX_VIEWPORT_SCALE,
  tolerance: ZOOM_PRECISION_TOLERANCE,
  referenceWorld: ZOOM_REFERENCE_WORLD_SIZE,
  referenceTranslation: ZOOM_REFERENCE_TRANSLATION,
}

export const VIEWPORT_CONFIG = {
  defaultDprCap: 1.5,
  minZoom: Math.max(MIN_VIEWPORT_SCALE, UI_MIN_SCALE),
  maxZoom: Math.min(MAX_VIEWPORT_SCALE, UI_MAX_SCALE),
}
