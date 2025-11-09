export interface Config {
  bucket: string | null
  endpoint: string | null
  region: string | null
  accessKeyId: string | null
  secretAccessKey: string | null
  localDir: string | null
}

export interface OperationPayload {
  storageKey: string
  mimeType: string
}

export interface WorkerOptions {
  pollIntervalMs: number
}
