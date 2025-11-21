import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname)
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public')

const originalFetch = globalThis.fetch

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = input instanceof URL ? input : new URL(String(input), 'http://local.test')

  if (target.origin === 'http://local.test' && target.pathname.startsWith('/')) {
    const filePath = path.join(PUBLIC_DIR, target.pathname.replace(/^\//, ''))
    try {
      const buffer = await readFile(filePath)
      return new Response(buffer, { status: 200 })
    } catch (error) {
      return new Response(`Missing mock asset at ${filePath}: ${String(error)}`, { status: 404 })
    }
  }

  if (originalFetch) {
    return originalFetch(input as any, init)
  }

  throw new Error('fetch is not available in this test environment')
}
