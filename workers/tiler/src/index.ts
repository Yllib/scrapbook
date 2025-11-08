import { S3Client } from '@aws-sdk/client-s3'

export function createS3Client() {
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        }
      : undefined,
  })
}

export async function bootstrap() {
  const s3 = createS3Client()
  const regionConfig = s3.config.region
  const region = typeof regionConfig === 'function' ? await regionConfig() : regionConfig

  console.log('[tiler] bootstrap complete', {
    region,
    bucket: process.env.S3_BUCKET ?? 'scrapbook',
  })

  s3.destroy()
}

if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('[tiler] bootstrap failure', error)
    process.exitCode = 1
  })
}
