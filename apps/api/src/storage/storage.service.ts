import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { createWriteStream, promises as fsPromises } from 'fs';
import { createReadStream } from 'fs';
import { join, dirname } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { randomUUID, createHash } from 'crypto';

export interface PutObjectOptions {
  key?: string;
  contentType: string;
  body: Buffer | Readable;
}

export interface StoredObjectMetadata {
  key: string;
  size: number;
  checksum: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client | null;
  private readonly bucket: string | null;
  private readonly localDir: string | null;

  constructor(private readonly config: ConfigService) {
    const bucket = config.get<string>('S3_BUCKET');
    const endpoint = config.get<string>('S3_ENDPOINT');
    const region = config.get<string>('S3_REGION') ?? 'us-east-1';
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
    const localDir = config.get<string>('ASSET_STORAGE_DIR');

    if (bucket && accessKeyId && secretAccessKey) {
      this.bucket = bucket;
      this.localDir = null;
      this.s3Client = new S3Client({
        region,
        endpoint,
        forcePathStyle: Boolean(endpoint),
        credentials: { accessKeyId, secretAccessKey },
      });
      void this.ensureBucket();
    } else {
      this.bucket = null;
      this.localDir = localDir ?? join(process.cwd(), 'storage');
      this.s3Client = null;
      this.logger.warn(
        'S3 credentials missing – falling back to local storage. Set ASSET_STORAGE_DIR to customize path.',
      );
    }
  }

  generateKey(prefix: string, filename: string) {
    const safe = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const id = randomUUID();
    return `${prefix}/${id}-${safe}`;
  }

  async putObject(options: PutObjectOptions): Promise<StoredObjectMetadata> {
    const key = options.key ?? this.generateKey('uploads', randomUUID());
    if (this.s3Client && this.bucket) {
      const body =
        options.body instanceof Readable
          ? options.body
          : Readable.from(options.body);
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else if (typeof chunk === 'string') {
          chunks.push(Buffer.from(chunk));
        } else {
          chunks.push(Buffer.from(chunk as Uint8Array));
        }
      }
      const buffer = Buffer.concat(chunks);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: options.contentType,
        }),
      );
      return { key, size: buffer.length, checksum: checksum(buffer) };
    }

    if (!this.localDir) {
      throw new Error('No storage backend configured');
    }

    await fsPromises.mkdir(dirname(join(this.localDir, key)), {
      recursive: true,
    });
    const targetPath = join(this.localDir, key);
    const hash = createHash('sha256');
    if (options.body instanceof Readable) {
      const writeStream = createWriteStream(targetPath);
      options.body.on('data', (chunk) => hash.update(chunk as Buffer));
      await pipeline(options.body, writeStream);
      const stats = await fsPromises.stat(targetPath);
      return { key, size: stats.size, checksum: hash.digest('hex') };
    }

    const buffer = options.body;
    await fsPromises.writeFile(targetPath, buffer);
    return { key, size: buffer.length, checksum: checksum(buffer) };
  }

  async getObjectStream(key: string): Promise<Readable> {
    if (this.s3Client && this.bucket) {
      const result = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      const body = result.Body;
      if (!body || !(body instanceof Readable)) {
        throw new Error('Received empty body from storage');
      }
      return body;
    }

    if (!this.localDir) {
      throw new Error('No storage backend configured');
    }

    return createReadStream(join(this.localDir, key));
  }

  private async ensureBucket() {
    if (!this.s3Client || !this.bucket) return;
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const err = error as HeadBucketError;
      const status = err.$metadata?.httpStatusCode;
      if (status !== 404 && err.name !== 'NotFound' && err.name !== 'NoSuchBucket') {
        this.logger.error('Failed to verify bucket', error as Error);
        return;
      }

      this.logger.log(`Bucket ${this.bucket} missing – creating it.`);
      try {
        await this.s3Client.send(
          new CreateBucketCommand({
            Bucket: this.bucket,
          }),
        );
      } catch (createError) {
        const createErr = createError as CreateBucketError;
        const createStatus = createErr.$metadata?.httpStatusCode;
        if (createStatus === 409 || createErr.name === 'BucketAlreadyOwnedByYou') {
          this.logger.warn(`Bucket ${this.bucket} already exists.`);
          return;
        }
        this.logger.error('Failed to create bucket', createError as Error);
      }
    }
  }
}

function checksum(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

type HeadBucketError = {
  $metadata?: { httpStatusCode?: number };
  name?: string;
};

type CreateBucketError = HeadBucketError;
