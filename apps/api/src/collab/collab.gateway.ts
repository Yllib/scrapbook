import type { IncomingMessage } from 'http'
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { HttpAdapterHost } from '@nestjs/core'
import { Server as WebSocketServer, WebSocket } from 'ws'
import { getYDoc, setupWSConnection } from './ywebsocket'
import { PrismaService } from '../prisma/prisma.service'

const CLOSE_POLICY_VIOLATION = 1008
const SAVE_DEBOUNCE_MS = 2000

@Injectable()
export class CollabGateway implements OnModuleInit, OnModuleDestroy {
  private wss?: WebSocketServer
  private readonly logger = new Logger(CollabGateway.name)
  private readonly jwtSecret: string
  private readonly saveTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.jwtSecret = config.get<string>('AUTH_JWT_SECRET') ?? 'dev-secret-change-me'
  }

  onModuleInit() {
    const httpServer = this.adapterHost.httpAdapter.getHttpServer()
    // Accept WebSocket connections - path filtering happens in authorize()
    this.wss = new WebSocketServer({ server: httpServer })

    this.wss.on('connection', (socket, req) => {
      // Only handle /collab paths
      const url = req.url || ''
      if (!url.startsWith('/collab')) {
        socket.close(1003, 'Invalid path')
        return
      }

      this.logger.log(`collab upgrade url=${req.url}`)
      void this.handleConnection(socket, req)
    })
    this.logger.log('Collaboration websocket listening on /collab')
  }

  onModuleDestroy() {
    if (!this.wss) return
    this.wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down')
    })
    this.wss.close()
  }

  private async handleConnection(socket: WebSocket, req: IncomingMessage) {
    let isAlive = true
    let pingInterval: NodeJS.Timeout | null = null

    socket.on('close', (code, reason) => {
      if (pingInterval) clearInterval(pingInterval)
      this.logger.log(`collab socket closed code=${code} reason=${reason?.toString?.() ?? ''}`)
    })
    socket.on('error', (err: any) => {
      this.logger.warn(`collab socket error: ${err instanceof Error ? err.message : String(err)}`)
    })
    socket.on('pong', () => {
      isAlive = true
    })

    try {
      const { projectId, userId, initialScene } = await this.authorize(req)
      this.ensureDocHydrated(projectId, initialScene, userId)
      this.setupPersistence(projectId)
      setupWSConnection(socket as any, req, { docName: projectId, gc: false })
      this.logger.log(`collab client connected user=${userId} project=${projectId}`)

      // Start heartbeat ping/pong (every 20 seconds)
      pingInterval = setInterval(() => {
        if (!isAlive) {
          this.logger.warn(`collab client unresponsive, terminating user=${userId} project=${projectId}`)
          clearInterval(pingInterval!)
          ;(socket as any).terminate()
          return
        }
        isAlive = false
        socket.ping()
      }, 20000)
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unauthorized'
      socket.close(CLOSE_POLICY_VIOLATION, reason)
      this.logger.warn(`collab connection rejected: ${reason}`)
    }
  }

  private async authorize(req: IncomingMessage) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const projectId = url.searchParams.get('projectId') ?? url.pathname.split('/').filter(Boolean).pop()
    const token = url.searchParams.get('token') ?? this.extractBearer(req)

    if (!projectId) {
      throw new Error('Missing projectId')
    }
    if (!token) {
      throw new Error('Missing token')
    }

    const payload = await this.jwt.verifyAsync(token, { secret: this.jwtSecret })
    const userId = (payload as any)?.sub ?? (payload as any)?.id
    if (!userId) {
      throw new Error('Invalid token')
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId },
      select: { id: true, scene: true },
    })

    if (!project) {
      throw new Error('Project not found')
    }

    return { projectId: project.id, userId, initialScene: project.scene }
  }

  private extractBearer(req: IncomingMessage) {
    const header = req.headers['authorization']
    if (!header) return null
    const [type, token] = header.split(' ')
    if (!type || !token) return null
    return type.toLowerCase() === 'bearer' ? token : null
  }

  private ensureDocHydrated(projectId: string, scene: unknown, userId: string) {
    const doc = getYDoc(projectId)
    const state = doc.getMap('state')
    const yNodes = doc.getMap<any>('nodes')
    const yWorld = doc.getMap<any>('world')

    const hydrateFromScene = (sceneObj: any) => {
      const nodes = Array.isArray(sceneObj.nodes) ? sceneObj.nodes : []
      nodes.forEach((node: any) => {
        if (node?.id) {
          yNodes.set(node.id, node)
        }
      })
      if (sceneObj.world) {
        const pos = sceneObj.world.position ?? { x: 0, y: 0 }
        const scale = sceneObj.world.scale ?? 1
        yWorld.set('position', pos)
        yWorld.set('scale', scale)
      }
    }

    // If state has scene but yNodes is empty, they're out of sync (corrupted)
    // Reload from database to fix corruption
    if (state.has('scene') && yNodes.size === 0 && scene && typeof scene === 'object') {
      const sceneObj = scene as any
      state.set('scene', sceneObj)
      state.set('lastWriter', userId)
      hydrateFromScene(sceneObj)
      return
    }

    // Normal case: state and yNodes are in sync, preserve collaborative edits
    if (state.has('scene')) {
      return
    }

    // First connection: initialize from database
    if (scene && typeof scene === 'object') {
      const sceneObj = scene as any
      state.set('scene', sceneObj)
      state.set('lastWriter', userId)
      hydrateFromScene(sceneObj)
    }
  }

  private setupPersistence(projectId: string) {
    const doc = getYDoc(projectId)
    const yNodes = doc.getMap('nodes')
    const yWorld = doc.getMap('world')
    const state = doc.getMap('state')

    // Listen for changes and schedule saves
    const updateHandler = () => {
      this.scheduleSave(projectId, doc)
    }

    // Remove any existing listener to avoid duplicates
    doc.off('update', updateHandler as any)
    doc.on('update', updateHandler as any)
  }

  private scheduleSave(projectId: string, doc: any) {
    // Clear existing timer
    const existingTimer = this.saveTimers.get(projectId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Schedule new save
    const timer = setTimeout(() => {
      void this.saveProjectState(projectId, doc)
      this.saveTimers.delete(projectId)
    }, SAVE_DEBOUNCE_MS)

    this.saveTimers.set(projectId, timer)
  }

  private async saveProjectState(projectId: string, doc: any) {
    try {
      const yNodes = doc.getMap('nodes')
      const yWorld = doc.getMap('world')
      const state = doc.getMap('state')

      // Extract scene from Yjs doc
      const nodes = Array.from(yNodes.values())
      const worldPos = yWorld.get('position') ?? { x: 0, y: 0 }
      const worldScale = yWorld.get('scale') ?? 1

      const scene = {
        version: 1,
        nodes,
        world: {
          position: worldPos,
          scale: worldScale,
        },
        showGrid: state.get('showGrid') ?? true,
        showOrigin: state.get('showOrigin') ?? true,
        backgroundColor: state.get('backgroundColor') ?? '#020617',
      }

      // Save to database
      await this.prisma.project.update({
        where: { id: projectId },
        data: { scene },
      })

      this.logger.log(`Saved project ${projectId} to database`)
    } catch (error) {
      this.logger.error(`Failed to save project ${projectId}`, error)
    }
  }
}
