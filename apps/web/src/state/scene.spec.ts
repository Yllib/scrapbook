import { beforeEach, describe, expect, it } from 'vitest'
import {
  useSceneStore,
  screenToWorld,
  worldToScreen,
  type SceneNode,
  type AABB,
} from './scene'

const resetSceneStore = () => {
  useSceneStore.setState({
    nodes: [],
    selectedIds: [],
    lastSelectedId: null,
    world: { position: { x: 0, y: 0 }, scale: 1 },
    viewport: { width: 0, height: 0 },
  })
}

const createNode = (overrides: Partial<Omit<SceneNode, 'type'>>) => {
  const store = useSceneStore.getState()
  return store.createRectangleNode(overrides)
}

describe('scene store', () => {
  beforeEach(() => {
    resetSceneStore()
  })

  it('creates rectangles at the camera center and selects them', () => {
    const store = useSceneStore.getState()
    store.updateViewport({ width: 800, height: 600 })
    store.updateWorldTransform({ position: { x: 400, y: 300 }, scale: 1 })

    const created = store.createRectangleNode({ name: 'Test rectangle' })

    const next = useSceneStore.getState()
    expect(next.nodes).toHaveLength(1)
    expect(created.position).toEqual({ x: 0, y: 0 })
    expect(next.selectedIds).toEqual([created.id])
  })

  it('toggles selection membership via modifier helpers', () => {
    const a = createNode({ id: 'node-a', position: { x: -120, y: 0 } })
    const b = createNode({ id: 'node-b', position: { x: 120, y: 0 } })

    const state = useSceneStore.getState()
    state.setSelection([a.id])
    state.toggleSelection(b.id)

    expect(useSceneStore.getState().selectedIds).toEqual([a.id, b.id])

    state.toggleSelection(a.id)
    expect(useSceneStore.getState().selectedIds).toEqual([b.id])
  })

  it('selects nodes intersecting a marquee rectangle', () => {
    const state = useSceneStore.getState()
    state.updateViewport({ width: 800, height: 600 })
    state.updateWorldTransform({ position: { x: 400, y: 300 }, scale: 1 })

    const a = createNode({ id: 'node-a', position: { x: -150, y: -100 }, size: { width: 120, height: 120 } })
    const b = createNode({ id: 'node-b', position: { x: 40, y: 40 }, size: { width: 120, height: 120 } })
    const c = createNode({ id: 'node-c', position: { x: 320, y: 260 }, size: { width: 120, height: 120 } })

    const marquee: AABB = { minX: -220, minY: -220, maxX: 120, maxY: 120 }
    state.marqueeSelect(marquee, false)

    const nextSelected = useSceneStore.getState().selectedIds
    expect(new Set(nextSelected)).toEqual(new Set([a.id, b.id]))
    expect(nextSelected).not.toContain(c.id)
  })

  it('adds marquee content to the existing selection when additive', () => {
    const state = useSceneStore.getState()
    const a = createNode({ id: 'node-a', position: { x: -60, y: -60 }, size: { width: 80, height: 80 } })
    const b = createNode({ id: 'node-b', position: { x: 90, y: -20 }, size: { width: 80, height: 80 } })
    const c = createNode({ id: 'node-c', position: { x: 260, y: 200 }, size: { width: 80, height: 80 } })

    state.setSelection([a.id])
    state.marqueeSelect({ minX: 0, minY: -100, maxX: 200, maxY: 90 }, true)

    const nextSelected = useSceneStore.getState().selectedIds
    expect(new Set(nextSelected)).toEqual(new Set([a.id, b.id]))
    expect(nextSelected).not.toContain(c.id)
  })

  it('handles world transforms with extremely small scales', () => {
    const state = useSceneStore.getState()
    state.updateViewport({ width: 1000, height: 1000 })
    state.updateWorldTransform({ position: { x: 500, y: 500 }, scale: 1e-12 })

    const screenPoint = { x: 510, y: 520 }
    const worldPoint = screenToWorld(screenPoint, state.world)
    expect(Number.isFinite(worldPoint.x)).toBe(true)
    expect(Number.isFinite(worldPoint.y)).toBe(true)

    const backToScreen = worldToScreen(worldPoint, state.world)
    expect(backToScreen.x).toBeCloseTo(screenPoint.x, 6)
    expect(backToScreen.y).toBeCloseTo(screenPoint.y, 6)
  })
})
