import { useEffect } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { useRef } from 'react'
import { useAuthStore } from '../state/auth'
import { useSceneStore, screenToWorld } from '../state/scene'
import type { SceneNode } from '../state/scene'
import type { RemoteCursor } from '../state/scene'

const LOCAL_ORIGIN = 'collab-local'
const PUSH_DEBOUNCE_MS = 250
const colorFromId = (id: string) => {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue},70%,50%)`
}

const buildCollabUrl = () => {
  // In development with Vite, construct absolute WebSocket URL from window.location
  // (Firefox requires absolute URLs, Chrome accepts relative URLs)
  // In production, use configured API target or default
  if (import.meta.env.DEV) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/collab`
  }
  const urlBase =
    (import.meta.env.VITE_API_PROXY_TARGET as string | undefined) ??
    'http://localhost:3000'
  const url = new URL('/collab', urlBase)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function useCollaboration(projectId?: string | null) {
  const token = useAuthStore((s) => s.token)
  const setRemoteCursors = useSceneStore((s) => s.setRemoteCursors)
  const setRemoteSelections = useSceneStore((s) => s.setRemoteSelections)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const docRef = useRef<Y.Doc | null>(null)

  useEffect(() => {
    if (!projectId || !token) return
    if (typeof window === 'undefined') return

    // Clean up any existing provider/doc before creating a new one
    if (providerRef.current) {
      providerRef.current.destroy()
      providerRef.current = null
    }
    if (docRef.current) {
      docRef.current.destroy()
      docRef.current = null
    }

    const doc = new Y.Doc()
    const yNodes = doc.getMap<SceneNode>('nodes')
    const stateMap = doc.getMap<any>('state')
    const url = buildCollabUrl()
    const provider = new WebsocketProvider(url, projectId, doc, {
      params: { token },
      connect: true,
      disableBc: true,
    })

    // Set initial status
    useSceneStore.getState().setCollabStatus('connecting', null)

    let ready = false
    let applyingRemote = false
    provider.on('connection-error', (event) => {
      console.error('collab connection error', event)
      useSceneStore.getState().setCollabStatus('error', 'Connection error')
    })
    provider.on('connection-close', (event: any) => {
      const code = event?.code
      const reason = event?.reason
      console.warn('collab connection closed', code, reason)

      // Detect auth failures (code 1008 = Policy Violation)
      if (code === 1008) {
        useSceneStore.getState().setCollabStatus('error', 'Authentication failed')
        provider.disconnect()  // Stop reconnection attempts
      } else {
        useSceneStore.getState().setCollabStatus('disconnected', null)
      }
    })
    provider.on('status', (event: any) => {
      if (event.status === 'connected') {
        ready = true
        useSceneStore.getState().setCollabStatus('connected', null)
        const selectionNow = useSceneStore.getState().selectedIds
        provider.awareness.setLocalStateField('selection', selectionNow)
      } else if (event.status === 'disconnected') {
        ready = false
        useSceneStore.getState().setCollabStatus('disconnected', null)
      } else if (event.status === 'connecting') {
        useSceneStore.getState().setCollabStatus('connecting', null)
      }
    })
    const user = useAuthStore.getState().user
    const userId = user?.id ?? 'anon'
    const userLabel = user?.email ?? 'User'
    const userColor = colorFromId(userId)
    provider.awareness.setLocalState({
      userId,
      label: userLabel,
      color: userColor,
      cursor: { x: 0, y: 0 },
    })
    // If the server seeded a snapshot in state, hydrate nodes/world from it
    const serverScene = stateMap.get('scene') as any | undefined
    if (yNodes.size === 0 && serverScene?.nodes) {
      doc.transact(
        () => {
          ;(serverScene.nodes as SceneNode[]).forEach((node) => yNodes.set(node.id, node))
        },
        LOCAL_ORIGIN,
      )
    }

    // Seed doc from local scene if still empty
    if (yNodes.size === 0) {
      const scene = useSceneStore.getState().toSceneDocument()
      doc.transact(
        () => {
          scene.nodes.forEach((node) => yNodes.set(node.id, node))
        },
        LOCAL_ORIGIN,
      )
    }
    if (provider.ws) {
      provider.ws.onclose = (ev) => {
        if (ev.code !== 1000 && ev.code !== 1001) {
          console.warn('collab unexpected close', ev.code, ev.reason)
        }
      }
      provider.ws.onerror = (ev) => {
        console.error('collab error', ev)
      }
    }

    let updatingRemoteCursors = false
    let lastRemoteSelectionKeys: string[] = []
    const updateRemoteCursors = () => {
      updatingRemoteCursors = true
      try {
        const awarenessStates = Array.from(provider.awareness.getStates().entries())
        const cursorMap = new Map<string, RemoteCursor>()
        const selectionByNode = new Map<string, { nodeId: string; color: string; label: string }>()
        awarenessStates.forEach(([clientId, state], index) => {
          if (clientId === provider.awareness.clientID) return
          const cursor = (state as any)?.cursor
          const selection = ((state as any)?.selection as string[] | undefined) ?? []
          const id = String(clientId ?? index)
          const color = (state as any)?.color ?? '#10b981'
          const label = (state as any)?.label ?? 'User'
          cursorMap.set(id, {
            id,
            x: cursor?.x ?? 0,
            y: cursor?.y ?? 0,
            color,
            label,
            selectedIds: selection,
          })
          selection.forEach((nodeId) => {
            if (selectionByNode.has(nodeId)) return
            selectionByNode.set(nodeId, { nodeId, color, label })
          })
        })

        // Always update cursors (they change on every mouse move)
        setRemoteCursors(Array.from(cursorMap.values()))

        // Only update selections if they actually changed
        const newSelectionKeys = Array.from(selectionByNode.keys()).sort()
        const selectionsChanged =
          newSelectionKeys.length !== lastRemoteSelectionKeys.length ||
          newSelectionKeys.some((key, i) => key !== lastRemoteSelectionKeys[i])

        if (selectionsChanged) {
          lastRemoteSelectionKeys = newSelectionKeys
          setRemoteSelections(Array.from(selectionByNode.values()), newSelectionKeys)
        }
      } finally {
        updatingRemoteCursors = false
      }
    }

    // Keep remote peers informed of our live selection
    provider.awareness.setLocalStateField('selection', useSceneStore.getState().selectedIds)
    const unsubscribeSelectionAwareness = useSceneStore.subscribe((state) => {
      // Prevent infinite loop when updating remote cursors triggers state changes
      if (updatingRemoteCursors) return
      provider.awareness.setLocalStateField('selection', state.selectedIds)
    })
    const pushLocal = (state = useSceneStore.getState()) => {
      if (state.viewOnly) return
      if (applyingRemote) return
      if (state.nodes === lastPushedNodes) return
      const currentNodes = state.nodes
      doc.transact(
        () => {
          const existingIds = new Set(yNodes.keys())
          currentNodes.forEach((node) => {
            const existing = yNodes.get(node.id)
            const changed = !existing || JSON.stringify(existing) !== JSON.stringify(node)
            if (changed) {
              yNodes.set(node.id, node)
            }
            existingIds.delete(node.id)
          })
          existingIds.forEach((id) => yNodes.delete(id))
        },
        LOCAL_ORIGIN,
      )
      lastPushedNodes = currentNodes
    }

    let lastPushedNodes = useSceneStore.getState().nodes

    let pushTimer: number | null = null
    const schedulePush = () => {
      if (pushTimer) {
        window.clearTimeout(pushTimer)
      }
      pushTimer = window.setTimeout(() => pushLocal(), PUSH_DEBOUNCE_MS)
    }

    const unsubscribeScene = useSceneStore.subscribe((state) => {
      if (!ready) return
      pushLocal(state)
      schedulePush()
    })

    const applyFromDoc = (event?: { transaction?: { origin?: unknown } }) => {
      if (event?.transaction?.origin === LOCAL_ORIGIN) return
      applyingRemote = true
      const nodes = Array.from(yNodes.values())
      useSceneStore.setState((prev) => {
        const selectedIds = prev.selectedIds.filter((id) => nodes.some((n) => n.id === id))
        return {
          ...prev,
          nodes,
          selectedIds,
          lastSelectedId: selectedIds.at(-1) ?? null,
        }
      })
      applyingRemote = false
      updateRemoteCursors()
    }

    const onSync = (synced: boolean) => {
      if (!synced) return
      applyFromDoc()
      ready = true
    }

    provider.awareness.on('update', updateRemoteCursors)

    // Cache stage host element and bounds to avoid expensive DOM queries on every pointermove
    let stageHost: Element | null = null
    let cachedBounds: DOMRect | null = null
    let rafHandle = 0
    let latestPointerEvent: PointerEvent | null = null

    const updateBounds = () => {
      stageHost = document.querySelector('.stage-host')
      if (stageHost) {
        cachedBounds = stageHost.getBoundingClientRect()
      }
    }

    const processCursorUpdate = () => {
      rafHandle = 0
      if (!latestPointerEvent) return
      if (!provider.ws || provider.ws.readyState !== WebSocket.OPEN) return
      if (!stageHost || !cachedBounds) return

      const event = latestPointerEvent
      latestPointerEvent = null

      const canvasPoint = {
        x: event.clientX - cachedBounds.left,
        y: event.clientY - cachedBounds.top,
      }

      const worldPos = screenToWorld(canvasPoint, useSceneStore.getState().world)
      provider.awareness.setLocalStateField('cursor', worldPos)
    }

    const handlePointer = (event: PointerEvent) => {
      latestPointerEvent = event
      if (rafHandle) return // Already scheduled
      rafHandle = requestAnimationFrame(processCursorUpdate)
    }

    const handleResize = () => {
      updateBounds()
    }

    // Initialize bounds
    updateBounds()

    window.addEventListener('pointermove', handlePointer, { passive: true })
    window.addEventListener('resize', handleResize, { passive: true })

    yNodes.observe(applyFromDoc)
    // Only observe shared nodes; viewport/world stays local per user
    provider.on('sync', onSync)

    providerRef.current = provider
    docRef.current = doc

    return () => {
      yNodes.unobserve(applyFromDoc)
      provider.off('sync', onSync)
      provider.awareness.off('update', updateRemoteCursors)
      window.removeEventListener('pointermove', handlePointer)
      window.removeEventListener('resize', handleResize)
      if (rafHandle) {
        cancelAnimationFrame(rafHandle)
      }
      unsubscribeScene()
      unsubscribeSelectionAwareness()
      if (pushTimer) {
        window.clearTimeout(pushTimer)
      }
      provider.destroy()
      doc.destroy()
      providerRef.current = null
      docRef.current = null
    }
  }, [projectId, token])
}
