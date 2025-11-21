import { describe, expect, it } from 'vitest'
import type { SceneNode } from '../state/scene'
import { calculateGroupSelectionOverlay, calculateSelectionHandleSizing } from './selectionOverlay'

const makeNode = (overrides: Partial<SceneNode>): SceneNode => ({
  id: 'node',
  name: 'Node',
  type: 'rectangle',
  position: { x: 0, y: 0 },
  size: { width: 100, height: 80 },
  rotation: 0,
  ...overrides,
})

describe('selectionOverlay utilities', () => {
  describe('calculateGroupSelectionOverlay', () => {
    it('returns null when no nodes are provided', () => {
      expect(calculateGroupSelectionOverlay([])).toBeNull()
    })

    it('computes geometry for a single node', () => {
      const geometry = calculateGroupSelectionOverlay([makeNode({ id: 'a' })])
      expect(geometry).not.toBeNull()
      expect(geometry?.width).toBeGreaterThan(0)
      expect(geometry?.height).toBeGreaterThan(0)
      expect(geometry?.rotationHandle).toBeDefined()
      expect(geometry?.rotation).toBeCloseTo(0)
    })

    it('computes bounding geometry for two nodes', () => {
      const nodes: SceneNode[] = [
        makeNode({ id: 'a', position: { x: -50, y: 0 }, size: { width: 100, height: 60 } }),
        makeNode({ id: 'b', position: { x: 150, y: 20 }, size: { width: 120, height: 100 } }),
      ]

      const geometry = calculateGroupSelectionOverlay(nodes)
      expect(geometry).not.toBeNull()
      expect(geometry?.center).toEqual({ x: 55, y: 20 })
      expect(geometry?.width).toBeCloseTo(310)
      expect(geometry?.height).toBeCloseTo(100)

      // Corners are expressed relative to center
      expect(geometry?.corners).toEqual([
        { x: -155, y: -50 },
        { x: 155, y: -50 },
        { x: 155, y: 50 },
        { x: -155, y: 50 },
      ])
      expect(geometry?.rotationHandle.y ?? 0).toBeLessThan(-50)
    })

    it('returns stable geometry when nodes overlap completely', () => {
      const nodes: SceneNode[] = [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b', position: { x: 10, y: 10 }, size: { width: 50, height: 40 } }),
      ]

      const geometry = calculateGroupSelectionOverlay(nodes)
      expect(geometry).not.toBeNull()
      expect(geometry?.width).toBeGreaterThan(0)
      expect(geometry?.height).toBeGreaterThan(0)
    })

    it('averages rotation across selected nodes', () => {
      const nodes: SceneNode[] = [
        makeNode({ id: 'a', rotation: Math.PI / 4 }),
        makeNode({ id: 'b', rotation: Math.PI / 4 }),
      ]

      const geometry = calculateGroupSelectionOverlay(nodes)
      expect(geometry).not.toBeNull()
      expect(geometry?.rotation).toBeCloseTo(Math.PI / 4)
    })

    it('respects polygon points when computing bounds', () => {
      const nodes: SceneNode[] = [
        makeNode({
          id: 'polygon',
          type: 'shape',
          shape: {
            kind: 'polygon',
            points: [
              { x: 0, y: -0.5 },
              { x: 0.5, y: 0.5 },
              { x: -0.5, y: 0.5 },
            ],
          },
        }),
      ]

      const geometry = calculateGroupSelectionOverlay(nodes)
      expect(geometry).not.toBeNull()
      expect(geometry?.width).toBeCloseTo(100)
      expect(geometry?.height).toBeCloseTo(80)
    })
  })

  describe('calculateSelectionHandleSizing', () => {
    it('returns consistent sizing regardless of scale', () => {
      const unit = calculateSelectionHandleSizing()
      const zoomedIn = calculateSelectionHandleSizing()
      const zoomedOut = calculateSelectionHandleSizing()
      expect(unit).toEqual(zoomedIn)
      expect(unit).toEqual(zoomedOut)
    })
  })
})
