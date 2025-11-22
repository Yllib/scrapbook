declare module 'ws' {
  import type { EventEmitter } from 'node:events'
  import type { IncomingMessage } from 'node:http'

  export type RawData = string | ArrayBufferLike | ArrayBufferView

  export class WebSocket extends EventEmitter {
    readyState: number
    close(code?: number, reason?: string): void
    send(data: RawData, options?: { binary?: boolean }): void
    on(event: 'close', cb: (code: number, reason: Buffer) => void): this
    on(event: 'message', cb: (data: RawData, isBinary: boolean) => void): this
  }

  export interface WebSocketServerOptions {
    server?: any
    path?: string
  }

  export class Server<T = WebSocket> extends EventEmitter {
    constructor(options?: WebSocketServerOptions)
    on(event: 'connection', cb: (socket: T, request: IncomingMessage) => void): this
    close(cb?: () => void): void
    clients: Set<T>
  }
}

declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http'
  import type { WebSocket } from 'ws'
  import type { Awareness } from 'y-protocols/awareness'
  import * as Y from 'yjs'

  export interface WSSharedDoc extends Y.Doc {
    name: string
    conns: Map<WebSocket, Set<number>>
    awareness: Awareness
  }

  export function getYDoc(docName: string): WSSharedDoc
  export function setupWSConnection(conn: WebSocket, req: IncomingMessage, opts?: { docName: string; gc?: boolean }): void
}
