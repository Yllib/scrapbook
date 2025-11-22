import path from 'node:path'
import sharp from 'sharp'
import dotenv from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { StorageClient } from './storage'
import { Config, OperationPayload, WorkerOptions } from './types'

const rootDir = path.resolve(__dirname, '../../..')
dotenv.config({ path: path.join(rootDir, '.env') })
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true })

const TILE_SIZE = 256
// Downscale factor per additional LOD (power-of-two pyramid: level z => scale = 2^z)
const LOD_STEP = 2

const config: Config = {
  bucket: process.env.S3_BUCKET ?? null,
  endpoint: process.env.S3_ENDPOINT ?? null,
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID ?? null,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? null,
  localDir: process.env.ASSET_STORAGE_DIR ?? null,
}

const options: WorkerOptions = {
  pollIntervalMs: Number.parseInt(process.env.TILER_POLL_INTERVAL_MS ?? '2000', 10),
}

const prisma = new PrismaClient()
const storage = new StorageClient(config)

async function processNext() {
  const operation = await prisma.operation.findFirst({
    where: { type: 'asset.process', status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  })

  if (!operation) {
    return false
  }

  const claimed = await prisma.operation.updateMany({
    where: { id: operation.id, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  })

  if (claimed.count === 0) {
    return false
  }

  try {
    const payload = operation.payload as unknown as OperationPayload
    await processAsset(operation.assetId!, payload)
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
    })
  } catch (error) {
    console.error('[tiler] failed to process operation', operation.id, error)
    const message = error instanceof Error ? error.message : String(error)
    if (operation.assetId) {
      await prisma.asset.update({
        where: { id: operation.assetId },
        data: {
          status: 'FAILED',
          failureReason: message,
        },
      })
    }
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        status: 'FAILED',
        error: message,
        processedAt: new Date(),
      },
    })
  }

  return true
}

async function processAsset(assetId: string, payload: OperationPayload) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } })
  if (!asset) {
    throw new Error(`Asset ${assetId} not found`)
  }

  await prisma.asset.update({
    where: { id: assetId },
    data: {
      status: 'PROCESSING',
      failureReason: null,
    },
  })

  const buffer = await storage.getObject(payload.storageKey)
  const metadata = await sharp(buffer).metadata()

  await prisma.assetVariant.deleteMany({ where: { assetId } })
  await prisma.assetTile.deleteMany({ where: { assetId } })

  await generateVariants(assetId, buffer, metadata.width ?? 0, metadata.height ?? 0)
  await generateTiles(assetId, buffer, metadata.width ?? 0, metadata.height ?? 0)
  await verifyTileAvailability(assetId)

  // Only mark READY after all tiles are written and reachable
  await prisma.asset.update({
    where: { id: assetId },
    data: {
      status: 'READY',
      width: metadata.width ?? asset.width,
      height: metadata.height ?? asset.height,
    },
  })
}

async function generateVariants(assetId: string, source: Buffer, width: number, height: number) {
  const maxDimension = Math.max(width, height)
  const target = Math.min(maxDimension, 2048)
  const resizeOptions = maxDimension > target ? { width: Math.round((width / maxDimension) * target) } : {}

  const avifBuffer = await sharp(source)
    .resize(resizeOptions)
    .withMetadata({})
    .avif({ quality: 70 })
    .toBuffer()

  const avifKey = storage.generateKey(`variants/${assetId}`, `${assetId}.avif`)
  const avifStored = await storage.putObject({ key: avifKey, contentType: 'image/avif', body: avifBuffer })
  const avifMeta = await sharp(avifBuffer).metadata()

  await prisma.assetVariant.create({
    data: {
      assetId,
      format: 'AVIF',
      width: avifMeta.width ?? width,
      height: avifMeta.height ?? height,
      size: avifStored.size,
      mimeType: 'image/avif',
      storageKey: avifStored.key,
    },
  })

  const webpBuffer = await sharp(source)
    .resize(resizeOptions)
    .webp({ quality: 80 })
    .toBuffer()

  const webpKey = storage.generateKey(`variants/${assetId}`, `${assetId}.webp`)
  const webpStored = await storage.putObject({ key: webpKey, contentType: 'image/webp', body: webpBuffer })
  const webpMeta = await sharp(webpBuffer).metadata()

  await prisma.assetVariant.create({
    data: {
      assetId,
      format: 'WEBP',
      width: webpMeta.width ?? width,
      height: webpMeta.height ?? height,
      size: webpStored.size,
      mimeType: 'image/webp',
      storageKey: webpStored.key,
    },
  })
}

async function generateTiles(assetId: string, source: Buffer, width: number, height: number) {
  if (!width || !height) {
    return
  }

  const maxDimension = Math.max(width, height)
  const levels: number[] = []
  let level = 0
  let currentMax = maxDimension
  // Build pyramid until the largest dimension fits within a single tile (or hits level cap)
  while (true) {
    levels.push(level)
    if (currentMax <= TILE_SIZE) break
    level += 1
    currentMax = Math.max(1, Math.ceil(maxDimension / LOD_STEP ** level))
  }

  for (const level of levels) {
    await generateTilesForLevel(assetId, source, width, height, level)
  }
}
async function generateTilesForLevel(
  assetId: string,
  source: Buffer,
  width: number,
  height: number,
  level: number,
) {
  const scale = LOD_STEP ** level
  const targetWidth = Math.max(1, Math.ceil(width / scale))
  const targetHeight = Math.max(1, Math.ceil(height / scale))
  const quality = Math.max(50, 80 - level * 5)
  const tileSource =
    scale === 1
      ? source
      : await sharp(source)
          .resize(targetWidth, targetHeight, {
            fit: 'fill',
            fastShrinkOnLoad: true,
            withoutEnlargement: true,
          })
          .toBuffer()

  const sourceMeta = await sharp(tileSource).metadata()
  const sourceWidth = Math.max(1, sourceMeta.width ?? targetWidth)
  const sourceHeight = Math.max(1, sourceMeta.height ?? targetHeight)
  const cols = Math.max(1, Math.ceil(sourceWidth / TILE_SIZE))
  const rows = Math.max(1, Math.ceil(sourceHeight / TILE_SIZE))

  const bleed = 2 // replicate 2px from neighboring pixels to avoid visible seams
  const tilePromises: Promise<void>[] = []

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const left = x * TILE_SIZE
      const top = y * TILE_SIZE
      const tileWidth = Math.max(1, Math.min(TILE_SIZE, sourceWidth - left))
      const tileHeight = Math.max(1, Math.min(TILE_SIZE, sourceHeight - top))

      // Expand extraction bounds by bleed on all sides, clamped to the source limits
      const bleedLeft = Math.min(bleed, left)
      const bleedTop = Math.min(bleed, top)
      const bleedRight = Math.min(bleed, Math.max(0, sourceWidth - (left + tileWidth)))
      const bleedBottom = Math.min(bleed, Math.max(0, sourceHeight - (top + tileHeight)))

      const extractLeft = left - bleedLeft
      const extractTop = top - bleedTop
      const extractWidth = tileWidth + bleedLeft + bleedRight
      const extractHeight = tileHeight + bleedTop + bleedBottom
      let safeLeft = Math.max(0, extractLeft)
      let safeTop = Math.max(0, extractTop)
      let availableX = sourceWidth - safeLeft
      let availableY = sourceHeight - safeTop
      if (availableX <= 0) {
        safeLeft = Math.max(0, sourceWidth - 1)
        availableX = sourceWidth - safeLeft
      }
      if (availableY <= 0) {
        safeTop = Math.max(0, sourceHeight - 1)
        availableY = sourceHeight - safeTop
      }
      const safeWidth = Math.max(1, Math.min(extractWidth, availableX))
      const safeHeight = Math.max(1, Math.min(extractHeight, availableY))

      const tilePromise = (async () => {
        try {
          const extracted = await sharp(tileSource)
            .extract({ left: safeLeft, top: safeTop, width: safeWidth, height: safeHeight })
            .toBuffer()

          const padded = await sharp(extracted)
            .extend({
              top: bleed - bleedTop,
              bottom: bleed - bleedBottom + Math.max(0, TILE_SIZE - tileHeight),
              left: bleed - bleedLeft,
              right: bleed - bleedRight + Math.max(0, TILE_SIZE - tileWidth),
              extendWith: 'background',
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .toBuffer()

          const paddedMeta = await sharp(padded).metadata()
          const neededWidth = bleed * 2 + TILE_SIZE
          const neededHeight = bleed * 2 + TILE_SIZE
          let normalized = padded
          if ((paddedMeta.width ?? 0) < neededWidth || (paddedMeta.height ?? 0) < neededHeight) {
            const extraRight = Math.max(0, neededWidth - (paddedMeta.width ?? 0))
            const extraBottom = Math.max(0, neededHeight - (paddedMeta.height ?? 0))
            normalized = await sharp(padded)
              .extend({
                top: 0,
                left: 0,
                right: extraRight,
                bottom: extraBottom,
                extendWith: 'background',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
              })
              .toBuffer()
          }

          const buffer = await sharp(normalized)
            .extract({ left: bleed, top: bleed, width: TILE_SIZE, height: TILE_SIZE })
            .webp({ quality, lossless: true, alphaQuality: 100 })
            .toBuffer()

          const key = storage.generateKey(`tiles/${assetId}/${level}`, `${x}-${y}.webp`)
          const stored = await storage.putObject({ key, contentType: 'image/webp', body: buffer })
          await prisma.assetTile.create({
            data: {
              assetId,
              z: level,
              x,
              y,
              size: stored.size,
              mimeType: 'image/webp',
              storageKey: stored.key,
            },
          })
        } catch (error) {
          console.error('[tiler] tile extract failed', {
            assetId,
            level,
            x,
            y,
            sourceWidth,
            sourceHeight,
            left,
            top,
            tileWidth,
            tileHeight,
            bleedLeft,
            bleedRight,
            bleedTop,
            bleedBottom,
            safeLeft,
            safeTop,
            safeWidth,
            safeHeight,
          })
          throw error
        }
      })()

      tilePromises.push(tilePromise)
    }
  }

  await Promise.all(tilePromises)
}

async function verifyTileAvailability(assetId: string) {
  const tiles = await prisma.assetTile.findMany({ where: { assetId }, select: { z: true, x: true, y: true, storageKey: true } })
  if (!tiles.length) return
  const checks: Promise<void>[] = []
  for (const tile of tiles) {
    const p = (async () => {
      const exists = await storage.exists(tile.storageKey)
      if (!exists) {
        throw new Error(`Tile not yet readable: ${tile.z}/${tile.x}/${tile.y}`)
      }
    })()
    checks.push(p)
  }
  // Allow a modest number of parallel head checks
  await Promise.all(checks)
}

async function main() {
  console.log('[tiler] worker starting')
  for (;;) {
    const processed = await processNext()
    if (!processed) {
      await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs))
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[tiler] fatal error', error)
    process.exitCode = 1
  })
}
