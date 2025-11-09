import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Config } from './types'
import { Readable } from 'stream'
import { createHash, randomUUID } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { promises as fsPromises } from 'fs'
import { dirname, join } from 'path'
import { pipeline } from 'stream/promises'

export interface PutObjectOptions {
  key?: string
  contentType: string
  body: Buffer | Readable
}

export interface StoredObject {
  key: string
  size: number
  checksum: string
}

export class StorageClient {
  private readonly bucket: string | null
  private readonly s3: S3Client | null
  private readonly localDir: string | null

  constructor(private readonly config: Config) {
    const { bucket, endpoint, region, accessKeyId, secretAccessKey, localDir } = config
    if (bucket && accessKeyId && secretAccessKey) {
      this.bucket = bucket
      this.localDir = null
      this.s3 = new S3Client({
        region: region ?? 'us-east-1',
        endpoint: endpoint ?? undefined,
        forcePathStyle: Boolean(endpoint),
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      })
    } else {
      this.bucket = null
      this.localDir = localDir ?? join(process.cwd(), 'storage')
      this.s3 = null
    }
  }

  generateKey(prefix: string, filename: string) {
    const safe = filename.replace(/[^a-zA-Z0-9_.-]/g, '_')
    return `${prefix}/${randomUUID()}-${safe}`
  }

  async putObject(options: PutObjectOptions): Promise<StoredObject> {
    const key = options.key ?? this.generateKey('uploads', randomUUID())
    if (this.s3 && this.bucket) {
      const buffer = await toBuffer(options.body)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: options.contentType,
        }),
      )
      return { key, size: buffer.length, checksum: checksum(buffer) }
    }

    if (!this.localDir) {
      throw new Error('Storage backend not configured')
    }
    const targetPath = join(this.localDir, key)
    await fsPromises.mkdir(dirname(targetPath), { recursive: true })

    if (options.body instanceof Readable) {
      const hash = createHash('sha256')
      const write = createWriteStream(targetPath)
      options.body.on('data', (chunk) => hash.update(chunk as Buffer))
      await pipeline(options.body, write)
      const stats = await fsPromises.stat(targetPath)
      return { key, size: stats.size, checksum: hash.digest('hex') }
    }

    if (!Buffer.isBuffer(options.body)) {
      throw new Error('Expected buffer body when writing to local storage')
    }

    await fsPromises.writeFile(targetPath, options.body)
    return { key, size: options.body.length, checksum: checksum(options.body) }
  }

  async getObject(key: string): Promise<Buffer> {
    if (this.s3 && this.bucket) {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      )
      const body = result.Body
      if (!body) throw new Error('Missing body')
      return toBuffer(body as Readable)
    }

    if (!this.localDir) {
      throw new Error('Storage backend not configured')
    }

    return toBuffer(createReadStream(join(this.localDir, key)))
  }
}

async function toBuffer(body: Buffer | Readable): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body
  }
  const chunks: Buffer[] = []
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function checksum(data: Buffer) {
  return createHash('sha256').update(data).digest('hex')
}
