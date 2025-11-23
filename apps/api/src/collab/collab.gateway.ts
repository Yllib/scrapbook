import type { IncomingMessage } from 'http'
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { HttpAdapterHost } from '@nestjs/core'
import { Server as WebSocketServer, WebSocket } from 'ws'
import { getYDoc, setupWSConnection } from './ywebsocket'
import { PrismaService } from '../prisma/prisma.service'

const CLOSE_POLICY_VIOLATION = 1008

@Injectable()
export class CollabGateway implements OnModuleInit, OnModuleDestroy {
  private wss?: WebSocketServer
  private readonly logger = new Logger(CollabGateway.name)
  private readonly jwtSecret: string

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
    socket.on('close', (code, reason) => {
      this.logger.log(`collab socket closed code=${code} reason=${reason?.toString?.() ?? ''}`)
    })
    socket.on('error', (err: any) => {
      this.logger.warn(`collab socket error: ${err instanceof Error ? err.message : String(err)}`)
    })
    try {
      const { projectId, userId, initialScene } = await this.authorize(req)
      this.ensureDocHydrated(projectId, initialScene, userId)
      setupWSConnection(socket as any, req, { docName: projectId, gc: false })
      this.logger.log(`collab client connected user=${userId} project=${projectId}`)
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

    if (state.has('scene')) {
      const sceneObj = state.get('scene')
      if (sceneObj && yNodes.size === 0) {
        hydrateFromScene(sceneObj)
      }
      return
    }

    if (scene && typeof scene === 'object') {
      const sceneObj = scene as any
      state.set('scene', sceneObj)
      state.set('lastWriter', userId)
      hydrateFromScene(sceneObj)
    }
  }
}
