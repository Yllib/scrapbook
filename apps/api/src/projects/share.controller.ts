import crypto from 'node:crypto'
import { Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/types'

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShareController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/share')
  async getActive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ensureOwner(user, id)
    const active = await this.prisma.shareToken.findFirst({
      where: { projectId: id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return { token: active?.token ?? null }
  }

  @Post(':id/share')
  async create(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ensureOwner(user, id)
    await this.prisma.shareToken.updateMany({ where: { projectId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    const token = crypto.randomUUID().replace(/-/g, '')
    await this.prisma.shareToken.create({ data: { projectId: id, token } })
    return { token }
  }

  @Delete(':id/share')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ensureOwner(user, id)
    await this.prisma.shareToken.updateMany({ where: { projectId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    return { success: true }
  }

  private async ensureOwner(user: AuthUser, projectId: string) {
    if (user.role === 'ADMIN') return true
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: user.id },
          { collaborators: { some: { userId: user.id, role: 'OWNER' } } },
        ],
      },
    })
    if (!project) {
      throw new NotFoundException('Project not found')
    }
    return true
  }
}

@Controller('share')
export class PublicShareController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':token')
  async resolve(@Param('token') token: string) {
    const share = await this.prisma.shareToken.findFirst({
      where: { token, revokedAt: null },
      include: {
        project: {
          select: { id: true, name: true, scene: true, updatedAt: true },
        },
      },
    })
    if (!share || !share.project) {
      throw new NotFoundException('Share link expired')
    }
    return { project: share.project }
  }
}
