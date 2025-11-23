import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as map from 'lib0/map'
import type { WebSocket } from 'ws'

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1
const pingTimeout = 30000

export interface WSSharedDoc extends Y.Doc {
  name: string
  conns: Map<WebSocket, Set<number>>
  awareness: awarenessProtocol.Awareness
}

export const docs = new Map<string, WSSharedDoc>()

const updateHandler = (update: Uint8Array, _origin: unknown, doc: WSSharedDoc) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeUpdate(encoder, update)
  const message = encoding.toUint8Array(encoder)
  doc.conns.forEach((_, conn) => send(doc, conn, message))
}

class ManagedDoc extends Y.Doc implements WSSharedDoc {
  name: string
  conns: Map<WebSocket, Set<number>>
  awareness: awarenessProtocol.Awareness

  constructor(name: string) {
    super({ gc: true })
    this.name = name
    this.conns = new Map()
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)
    this.on('update', (update, origin) => updateHandler(update, origin, this))

    const awarenessChangeHandler = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, conn: WebSocket | null) => {
      const changed = added.concat(updated, removed)
      if (conn) {
        const controlled = this.conns.get(conn)
        if (controlled) {
          added.forEach((id) => controlled.add(id))
          removed.forEach((id) => controlled.delete(id))
        }
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      const buff = encoding.toUint8Array(encoder)
      this.conns.forEach((_, c) => send(this, c, buff))
    }

    this.awareness.on('update', awarenessChangeHandler)
  }
}

export const getYDoc = (docName: string, gc = true): WSSharedDoc =>
  map.setIfUndefined(docs, docName, () => {
    const doc = new ManagedDoc(docName)
    doc.gc = gc
    docs.set(docName, doc)
    return doc
  })

const send = (doc: WSSharedDoc, conn: WebSocket, message: Uint8Array) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    // Connection is closed, remove it from the doc to prevent memory leaks
    closeConn(doc, conn, `dead-connection-${conn.readyState}`)
    return
  }
  try {
    conn.send(message, (err) => {
      if (err) {
        console.warn('[collab] send error', err)
        closeConn(doc, conn, 'send-error')
      }
    })
  } catch (err) {
    console.warn('[collab] send threw', err)
    closeConn(doc, conn, 'send-exception')
  }
}

const closeConn = (doc: WSSharedDoc, conn: WebSocket, reason: string = 'unknown') => {
  if (!doc.conns.has(conn)) return
  const controlled = doc.conns.get(conn)
  doc.conns.delete(conn)
  if (controlled && controlled.size > 0) {
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlled), null)
  }
  try {
    conn.close()
  } catch {
    // ignore
  }
  // eslint-disable-next-line no-console
  console.warn(`[collab] closing connection ${doc.name} reason=${reason}`)
  if (doc.conns.size === 0) {
    docs.delete(doc.name)
    doc.destroy()
  }
}

const messageListener = (conn: WebSocket, doc: WSSharedDoc, message: Uint8Array) => {
  try {
    const encoder = encoding.createEncoder()
    const decoder = decoding.createDecoder(message)
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case messageSync: {
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, doc, null)
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder))
        }
        break
      }
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn)
        break
      }
      default:
        console.warn(`[collab] received unknown message type ${messageType}`)
        break
    }
  } catch (err) {
    console.error('collab message error', err)
  }
}

export const setupWSConnection = (conn: WebSocket, req: { url?: string }, opts?: { docName?: string; gc?: boolean }) => {
  const docName = opts?.docName ?? req.url?.slice(1).split('?')[0]
  if (!docName) {
    conn.close()
    return
  }
  const gc = opts?.gc ?? true
  const doc = getYDoc(docName, gc)
  doc.conns.set(conn, new Set())

  conn.on('message', (message: ArrayBuffer) => messageListener(conn, doc, new Uint8Array(message)))

  conn.on('close', () => {
    closeConn(doc, conn, 'client-close')
  })

  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.writeSyncStep1(encoder, doc)
  send(doc, conn, encoding.toUint8Array(encoder))

  const awarenessStates = doc.awareness.getStates()
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, messageAwareness)
    encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())))
    send(doc, conn, encoding.toUint8Array(awarenessEncoder))
  }
}
