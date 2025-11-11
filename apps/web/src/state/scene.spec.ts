import { beforeEach, describe, expect, it } from 'vitest'
import {
  useSceneStore,
  screenToWorld,
  worldToScreen,
  type SceneNode,
  type AABB,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
} from './scene'

const resetSceneStore = () => {
  useSceneStore.setState({
    nodes: [],
    selectedIds: [],
    lastSelectedId: null,
    world: { position: { x: 0, y: 0 }, scale: 1 },
    viewport: { width: 0, height: 0 },
    history: { past: [], future: [], recording: false },
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

  it('creates shape nodes with defaults', () => {
    const state = useSceneStore.getState()
    const shape = state.createShapeNode({ kind: 'ellipse' })

    expect(shape.type).toBe('shape')
    expect(shape.fill).toBeDefined()
    expect(shape.stroke?.width).toBeGreaterThan(0)

    const latest = useSceneStore.getState().nodes.at(-1)
    expect(latest?.id).toBe(shape.id)
    expect(latest?.size.width).toBeGreaterThan(0)
  })

  it('creates image nodes with intrinsic sizing and tile grid', () => {
    const state = useSceneStore.getState()
    state.updateWorldTransform({ position: { x: 0, y: 0 }, scale: 2 })

    const imageNode = state.createImageNode({
      assetId: 'asset-1',
      intrinsicSize: { width: 512, height: 256 },
    })

    expect(imageNode.type).toBe('image')
    expect(imageNode.size.width).toBeCloseTo(256)
    expect(imageNode.size.height).toBeCloseTo(128)
    expect(imageNode.image?.grid?.columns).toBe(2)
    expect(imageNode.image?.grid?.rows).toBe(1)
    expect(imageNode.image?.tileLevels?.[0]).toEqual({ z: 0, columns: 2, rows: 1 })
    expect(imageNode.image?.maxTileLevel).toBe(0)
  })

  it('creates text nodes with defaults', () => {
    const state = useSceneStore.getState()
    const textNode = state.createTextNode()
    expect(textNode.type).toBe('text')
    expect(textNode.text?.content).toBeTruthy()
    expect(textNode.text?.fontFamily).toBe(DEFAULT_FONT_FAMILY)
    expect(textNode.text?.fontSize).toBe(DEFAULT_FONT_SIZE)
    expect(textNode.size.width).toBeGreaterThan(0)
  })

  it('updates selected text content and font metrics', () => {
    const state = useSceneStore.getState()
    const node = state.createTextNode({ id: 'text-1' })
    state.setSelection([node.id])
    state.updateSelectedTextContent('Hello world')
    let updated = useSceneStore.getState().nodes.find((n) => n.id === node.id)!
    expect(updated.text?.content).toBe('Hello world')
    const initialWidth = updated.size.width
    state.setSelectedFontSize(64)
    updated = useSceneStore.getState().nodes.find((n) => n.id === node.id)!
    expect(updated.text?.fontSize).toBe(64)
    expect(updated.size.width).toBeGreaterThan(initialWidth)
  })

  it('translates selection with undo/redo support', () => {
    const state = useSceneStore.getState()
    const a = createNode({ id: 'node-a', position: { x: 0, y: 0 }, size: { width: 100, height: 80 } })
    const b = createNode({ id: 'node-b', position: { x: 100, y: 0 }, size: { width: 120, height: 80 } })

    state.setSelection([a.id, b.id])
    state.startTransformSession()
    state.translateSelected({ x: 10, y: -5 })
    state.translateSelected({ x: 15, y: 5 })
    state.commitTransformSession()

    let nodes = useSceneStore.getState().nodes
    const nodeA = nodes.find((node) => node.id === a.id)!
    const nodeB = nodes.find((node) => node.id === b.id)!

    expect(nodeA.position).toEqual({ x: 25, y: 0 })
    expect(nodeB.position).toEqual({ x: 125, y: 0 })

    state.undo()
    nodes = useSceneStore.getState().nodes
    const undoA = nodes.find((node) => node.id === a.id)!
    const undoB = nodes.find((node) => node.id === b.id)!
    expect(undoA.position).toEqual({ x: 0, y: 0 })
    expect(undoB.position).toEqual({ x: 100, y: 0 })

    state.redo()
    nodes = useSceneStore.getState().nodes
    const redoA = nodes.find((node) => node.id === a.id)!
    const redoB = nodes.find((node) => node.id === b.id)!
    expect(redoA.position).toEqual({ x: 25, y: 0 })
    expect(redoB.position).toEqual({ x: 125, y: 0 })
  })

  it('scales selection relative to the transform center', () => {
    const state = useSceneStore.getState()
    const a = createNode({ id: 'node-a', position: { x: 0, y: 0 }, size: { width: 100, height: 100 } })
    const b = createNode({ id: 'node-b', position: { x: 100, y: 0 }, size: { width: 100, height: 50 } })

    state.setSelection([a.id, b.id])
    state.startTransformSession()
    state.scaleSelected({ x: 50, y: 0 }, 2, 2)
    state.commitTransformSession()

    const nodes = useSceneStore.getState().nodes
    const nodeA = nodes.find((node) => node.id === a.id)!
    const nodeB = nodes.find((node) => node.id === b.id)!

    expect(nodeA.position.x).toBeCloseTo(-50)
    expect(nodeA.size.width).toBeCloseTo(200)
    expect(nodeB.position.x).toBeCloseTo(150)
    expect(nodeB.size.height).toBeCloseTo(100)
  })

  it('keeps node aspect ratio locked when scaling unevenly', () => {
    const state = useSceneStore.getState()
    const node = createNode({ id: 'locked-node', position: { x: 0, y: 0 }, size: { width: 120, height: 60 } })

    state.setSelection([node.id])
    state.scaleSelected({ x: 0, y: 0 }, 2, 0.5)

    const updated = useSceneStore.getState().nodes.find((n) => n.id === node.id)!
    expect(updated.size.width).toBeCloseTo(240)
    expect(updated.size.height).toBeCloseTo(120)
    expect(updated.aspectRatioLocked).toBe(true)
  })

  it('allows non-uniform scaling when aspect ratio is unlocked', () => {
    const state = useSceneStore.getState()
    const node = createNode({ id: 'unlocked-node', position: { x: 0, y: 0 }, size: { width: 120, height: 60 } })

    state.setSelection([node.id])
    state.setSelectedAspectRatioLocked(false)
    state.scaleSelected({ x: 0, y: 0 }, 2, 0.5)

    const updated = useSceneStore.getState().nodes.find((n) => n.id === node.id)!
    expect(updated.size.width).toBeCloseTo(240)
    expect(updated.size.height).toBeCloseTo(30)
    expect(updated.aspectRatioLocked).toBe(false)
  })

  it('rotates selection around the transform center', () => {
    const state = useSceneStore.getState()
    const a = createNode({ id: 'node-a', position: { x: 0, y: 0 }, size: { width: 80, height: 80 } })
    const b = createNode({ id: 'node-b', position: { x: 100, y: 0 }, size: { width: 80, height: 80 } })

    state.setSelection([a.id, b.id])
    state.startTransformSession()
    state.rotateSelected({ x: 50, y: 0 }, Math.PI / 2)
    state.commitTransformSession()

    const nodes = useSceneStore.getState().nodes
    const nodeA = nodes.find((node) => node.id === a.id)!
    const nodeB = nodes.find((node) => node.id === b.id)!

    expect(nodeA.position.x).toBeCloseTo(50, 5)
    expect(nodeA.position.y).toBeCloseTo(-50, 5)
    expect(nodeA.rotation).toBeCloseTo(Math.PI / 2, 5)
    expect(nodeB.position.x).toBeCloseTo(50, 5)
    expect(nodeB.position.y).toBeCloseTo(50, 5)
    expect(nodeB.rotation).toBeCloseTo(Math.PI / 2, 5)

    state.undo()
    const originalA = useSceneStore.getState().nodes.find((node) => node.id === a.id)!
    const originalB = useSceneStore.getState().nodes.find((node) => node.id === b.id)!
    expect(originalA.position.x).toBeCloseTo(0)
    expect(originalA.position.y).toBeCloseTo(0)
    expect(originalA.rotation).toBeCloseTo(0)
    expect(originalB.position.x).toBeCloseTo(100)
    expect(originalB.position.y).toBeCloseTo(0)
    expect(originalB.rotation).toBeCloseTo(0)
  })

  it('updates fill and stroke for selected shapes', () => {
    const state = useSceneStore.getState()
    const shape = state.createShapeNode({ kind: 'rectangle', cornerRadius: 10 })
    state.updateSelectedFill('#ff0000')
    state.updateSelectedStroke({ color: '#00ff00', width: 4 })

    const updated = useSceneStore.getState().nodes.find((node) => node.id === shape.id)
    expect(updated?.fill).toBe('#ff0000')
    expect(updated?.stroke?.color).toBe('#00ff00')
    expect(updated?.stroke?.width).toBe(4)
  })

  it('updates corner radius for selected rectangles', () => {
    const state = useSceneStore.getState()
    const shape = state.createShapeNode({ kind: 'rectangle', cornerRadius: 8 })
    state.updateSelectedCornerRadius(24)

    const updated = useSceneStore.getState().nodes.find((node) => node.id === shape.id)
    expect(updated?.shape?.kind).toBe('rectangle')
    expect(updated?.shape?.kind === 'rectangle' ? updated.shape.cornerRadius : 0).toBe(24)
  })

  it('scales rectangle corner radius with transforms', () => {
    const state = useSceneStore.getState()
    const shape = state.createShapeNode({ kind: 'rectangle', cornerRadius: 10 }, { size: { width: 100, height: 80 } })
    state.setSelection([shape.id])
    state.startTransformSession()
    state.scaleSelected({ x: 0, y: 0 }, 2, 2)
    state.commitTransformSession()

    const updated = useSceneStore.getState().nodes.find((node) => node.id === shape.id)
    expect(updated?.shape?.kind).toBe('rectangle')
    expect(updated?.shape?.kind === 'rectangle' ? updated.shape.cornerRadius : 0).toBeCloseTo(20)
  })

  it('locks and unlocks nodes', () => {
    const state = useSceneStore.getState()
    const node = createNode({ id: 'lock-test', position: { x: 0, y: 0 } })
    state.setSelection([node.id])
    state.lockSelected()

    expect(useSceneStore.getState().nodes.find((n) => n.id === node.id)?.locked).toBe(true)
    expect(useSceneStore.getState().selectedIds).toHaveLength(0)

    useSceneStore.getState().unlockNodes([node.id])
    expect(useSceneStore.getState().nodes.find((n) => n.id === node.id)?.locked).toBe(false)
  })

  it('ignores locked nodes during marquee selection', () => {
    const state = useSceneStore.getState()
    const lockedNode = createNode({ id: 'locked', position: { x: 0, y: 0 } })
    state.setSelection([lockedNode.id])
    state.lockSelected()

    const unlocked = createNode({ id: 'free', position: { x: 200, y: 0 } })
    state.updateViewport({ width: 800, height: 600 })
    state.updateWorldTransform({ position: { x: 400, y: 300 }, scale: 1 })

    state.marqueeSelect({ minX: -10, minY: -10, maxX: 210, maxY: 10 }, false)

    const selected = useSceneStore.getState().selectedIds
    expect(selected).toEqual([unlocked.id])
  })

  it('reorders nodes front/back', () => {
    const state = useSceneStore.getState()
    const a = createNode({ id: 'a', name: 'A', position: { x: -200, y: 0 } })
    const b = createNode({ id: 'b', name: 'B', position: { x: 0, y: 0 } })
    const c = createNode({ id: 'c', name: 'C', position: { x: 200, y: 0 } })

    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([a.id, b.id, c.id])

    state.setSelection([b.id])
    state.bringSelectedToFront()
    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([a.id, c.id, b.id])

    state.sendSelectedToBack()
    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([b.id, a.id, c.id])

    state.setSelection([a.id])
    state.bringSelectedForward()
    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([b.id, c.id, a.id])

    state.sendSelectedBackward()
    expect(useSceneStore.getState().nodes.map((node) => node.id)).toEqual([b.id, a.id, c.id])
  })
})
