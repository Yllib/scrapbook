import sharp from 'sharp'
import { PrismaClient } from '@prisma/client'
import { StorageClient } from './storage'
import { Config, OperationPayload, WorkerOptions } from './types'

const TILE_SIZE = 256

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
    const payload = operation.payload as OperationPayload
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
  const maxLevel = Math.max(0, Math.ceil(Math.log2(maxDimension / TILE_SIZE)))

  for (let level = 0; level <= maxLevel; level += 1) {
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
  const scale = 2 ** level
  const targetWidth = Math.max(1, Math.ceil(width / scale))
  const targetHeight = Math.max(1, Math.ceil(height / scale))
  const cols = Math.max(1, Math.ceil(targetWidth / TILE_SIZE))
  const rows = Math.max(1, Math.ceil(targetHeight / TILE_SIZE))
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
  const tilePromises: Promise<void>[] = []

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const left = x * TILE_SIZE
      const top = y * TILE_SIZE
      const tileWidth = Math.max(1, Math.min(TILE_SIZE, targetWidth - left))
      const tileHeight = Math.max(1, Math.min(TILE_SIZE, targetHeight - top))

      const tilePromise = sharp(tileSource)
        .extract({ left, top, width: tileWidth, height: tileHeight })
        .resize(TILE_SIZE, TILE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality })
        .toBuffer()
        .then(async (buffer) => {
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
        })

      tilePromises.push(tilePromise)
    }
  }

  await Promise.all(tilePromises)
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
