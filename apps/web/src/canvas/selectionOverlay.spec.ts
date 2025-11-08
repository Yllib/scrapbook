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
    it('returns null when fewer than two nodes are provided', () => {
      expect(calculateGroupSelectionOverlay([])).toBeNull()
      expect(calculateGroupSelectionOverlay([makeNode({ id: 'a' })])).toBeNull()
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
  })

  describe('calculateSelectionHandleSizing', () => {
    it('uses minimum sizes at unit scale', () => {
      const sizing = calculateSelectionHandleSizing(1)
      expect(sizing.strokeWidth).toBeCloseTo(1.5)
      expect(sizing.cornerRadius).toBeCloseTo(6)
      expect(sizing.edgeRadius).toBeCloseTo(4.5)
    })

    it('shrinks handles as scale increases', () => {
      const sizing = calculateSelectionHandleSizing(10)
      expect(sizing.strokeWidth).toBeCloseTo(1.5)
      expect(sizing.cornerRadius).toBeCloseTo(6)

      const larger = calculateSelectionHandleSizing(100)
      expect(larger.cornerRadius).toBeCloseTo(6)
    })

    it('grows handles as scale decreases', () => {
      const sizing = calculateSelectionHandleSizing(0.1)
      expect(sizing.cornerRadius).toBeGreaterThan(6)
      expect(sizing.edgeRadius).toBeGreaterThan(4.5)
    })

    it('handles zero scale safely', () => {
      const sizing = calculateSelectionHandleSizing(0)
      expect(Number.isFinite(sizing.cornerRadius)).toBe(true)
      expect(sizing.cornerRadius).toBeGreaterThan(0)
    })
  })
})
