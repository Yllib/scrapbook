export interface TileCoordinate {
  z: number
  x: number
  y: number
}

export interface TileLevelDefinition {
  z: number
  columns: number
  rows: number
}

export const MIN_TILE_PIXEL_DENSITY = 0.85

export function pickTileLevel(baseDensity: number, maxLevel: number, minDensity = MIN_TILE_PIXEL_DENSITY) {
  if (!Number.isFinite(baseDensity) || baseDensity <= 0) {
    return Math.min(Math.max(0, maxLevel), 0)
  }
  if (baseDensity >= minDensity) {
    return 0
  }
  const ratio = minDensity / baseDensity
  const level = Math.ceil(Math.log2(ratio))
  if (!Number.isFinite(level) || level <= 0) {
    return 0
  }
  return Math.min(maxLevel, level)
}

export function summarizeTileLevels(tiles: TileCoordinate[]): TileLevelDefinition[] {
  if (!tiles.length) {
    return []
  }
  const stats = new Map<number, { maxX: number; maxY: number }>()
  for (const tile of tiles) {
    const record = stats.get(tile.z) ?? { maxX: -Infinity, maxY: -Infinity }
    record.maxX = Math.max(record.maxX, tile.x)
    record.maxY = Math.max(record.maxY, tile.y)
    stats.set(tile.z, record)
  }
  return Array.from(stats.entries())
    .map(([level, record]) => ({
      z: level,
      columns: Number.isFinite(record.maxX) ? record.maxX + 1 : 1,
      rows: Number.isFinite(record.maxY) ? record.maxY + 1 : 1,
    }))
    .sort((a, b) => a.z - b.z)
}

export function normalizeTileLevels(levels: TileLevelDefinition[]): TileLevelDefinition[] {
  if (!levels.length) return []
  const map = new Map<number, TileLevelDefinition>()
  for (const level of levels) {
    const existing = map.get(level.z)
    if (!existing) {
      map.set(level.z, { ...level })
      continue
    }
    map.set(level.z, {
      z: level.z,
      columns: Math.max(existing.columns, level.columns),
      rows: Math.max(existing.rows, level.rows),
    })
  }
  return Array.from(map.values()).sort((a, b) => a.z - b.z)
}

export function deriveSingleLevel(width: number, height: number, tileSize: number): TileLevelDefinition[] {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const safeTile = Math.max(1, tileSize)
  return [
    {
      z: 0,
      columns: Math.max(1, Math.ceil(safeWidth / safeTile)),
      rows: Math.max(1, Math.ceil(safeHeight / safeTile)),
    },
  ]
}

export function maxTileLevel(levels: TileLevelDefinition[] | undefined): number {
  if (!levels || levels.length === 0) return 0
  return levels[levels.length - 1].z
}
