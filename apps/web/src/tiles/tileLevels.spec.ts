import { describe, expect, it } from 'vitest'
import {
  deriveSingleLevel,
  maxTileLevel,
  normalizeTileLevels,
  pickTileLevel,
  summarizeTileLevels,
  type TileCoordinate,
} from './tileLevels'

describe('tileLevels helpers', () => {
  it('summarizes tile coordinates into ordered levels', () => {
    const input: TileCoordinate[] = [
      { z: 1, x: 0, y: 0 },
      { z: 0, x: 0, y: 0 },
      { z: 1, x: 3, y: 2 },
      { z: 0, x: 1, y: 1 },
    ]
    const summary = summarizeTileLevels(input)
    expect(summary).toEqual([
      { z: 0, columns: 2, rows: 2 },
      { z: 1, columns: 4, rows: 3 },
    ])
  })

  it('normalizes duplicate level entries by taking the largest grid', () => {
    const normalized = normalizeTileLevels([
      { z: 0, columns: 2, rows: 2 },
      { z: 0, columns: 4, rows: 1 },
      { z: 2, columns: 1, rows: 1 },
    ])
    expect(normalized).toEqual([
      { z: 0, columns: 4, rows: 2 },
      { z: 2, columns: 1, rows: 1 },
    ])
  })

  it('derives a single level grid when metadata is missing', () => {
    const derived = deriveSingleLevel(512, 128, 256)
    expect(derived).toEqual([{ z: 0, columns: 2, rows: 1 }])
  })

  it('returns the max tile level or zero when absent', () => {
    expect(maxTileLevel([])).toBe(0)
    expect(maxTileLevel([{ z: 0, columns: 1, rows: 1 }, { z: 3, columns: 1, rows: 1 }])).toBe(3)
  })

  it('picks level zero when density exceeds threshold', () => {
    expect(pickTileLevel(1.2, 5)).toBe(0)
  })

  it('picks higher zoom levels as density drops', () => {
    expect(pickTileLevel(0.4, 5)).toBe(2)
    expect(pickTileLevel(0.01, 4)).toBe(4)
  })

  it('caps picked level at the available maximum', () => {
    expect(pickTileLevel(0.001, 2)).toBe(2)
  })
})
