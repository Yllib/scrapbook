import type { Vec2, Size2D } from './scene'

const DEFAULT_SCENE_NORMALIZE_FACTOR = 2
const DEFAULT_MIN_SCENE_MANTISSA = 0.5
const DEFAULT_MAX_SCENE_MANTISSA = 4

export interface SceneNormalizationOptions {
  normalizeFactor?: number
  minMantissa?: number
  maxMantissa?: number
}

export interface SceneNormalizationState {
  mantissa: number
  exponent: number
  normalizeFactor: number
  minMantissa: number
  maxMantissa: number
}

export interface SceneNormalizationSnapshot {
  mantissa: number
  exponent: number
}

export function createSceneNormalizationState(
  initialScale = 1,
  options: SceneNormalizationOptions = {},
): SceneNormalizationState {
  const normalizeFactor = options.normalizeFactor ?? DEFAULT_SCENE_NORMALIZE_FACTOR
  const minMantissa = options.minMantissa ?? DEFAULT_MIN_SCENE_MANTISSA
  const maxMantissa = options.maxMantissa ?? DEFAULT_MAX_SCENE_MANTISSA
  let mantissa = Math.max(initialScale, Number.EPSILON)
  let exponent = 0

  ;({ mantissa, exponent } = normalizeMantissa(mantissa, exponent, {
    normalizeFactor,
    minMantissa,
    maxMantissa,
  }))

  return {
    mantissa,
    exponent,
    normalizeFactor,
    minMantissa,
    maxMantissa,
  }
}

export function cloneSceneNormalizationState(state: SceneNormalizationState): SceneNormalizationState {
  return { ...state }
}

export function snapshotSceneNormalization(state: SceneNormalizationState): SceneNormalizationSnapshot {
  return {
    mantissa: state.mantissa,
    exponent: state.exponent,
  }
}

export function restoreSceneNormalization(
  state: SceneNormalizationState,
  snapshot: SceneNormalizationSnapshot,
): SceneNormalizationState {
  return normalizeMantissa(snapshot.mantissa, snapshot.exponent, {
    normalizeFactor: state.normalizeFactor,
    minMantissa: state.minMantissa,
    maxMantissa: state.maxMantissa,
  })
}

export function getSceneScale(state: SceneNormalizationState): number {
  return state.mantissa * state.normalizeFactor ** state.exponent
}

export function applySceneScaleMultiplier(
  state: SceneNormalizationState,
  multiplier: number,
): SceneNormalizationState {
  if (!Number.isFinite(multiplier) || multiplier === 0) {
    return state
  }
  const mantissa = state.mantissa * multiplier
  return normalizeMantissa(mantissa, state.exponent, state)
}

export function scaleVec2(value: Vec2, scale: number): Vec2 {
  return {
    x: value.x * scale,
    y: value.y * scale,
  }
}

export function scaleSize(value: Size2D, scale: number): Size2D {
  return {
    width: value.width * scale,
    height: value.height * scale,
  }
}

function normalizeMantissa(
  mantissa: number,
  exponent: number,
  state: Pick<SceneNormalizationState, 'normalizeFactor' | 'minMantissa' | 'maxMantissa'>,
): SceneNormalizationState {
  const { normalizeFactor, minMantissa, maxMantissa } = state
  let nextMantissa = Math.max(mantissa, Number.EPSILON)
  let nextExponent = exponent

  while (nextMantissa >= maxMantissa) {
    nextMantissa /= normalizeFactor
    nextExponent += 1
  }

  while (nextMantissa < minMantissa) {
    nextMantissa *= normalizeFactor
    nextExponent -= 1
  }

  return {
    mantissa: nextMantissa,
    exponent: nextExponent,
    normalizeFactor,
    minMantissa,
    maxMantissa,
  }
}
