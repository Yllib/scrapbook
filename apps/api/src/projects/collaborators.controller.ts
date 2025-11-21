import { Body, Controller, Delete, Get, Param, Post, UseGuards, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/types'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'

interface AddCollaboratorBody {
  email?: string
  userId?: string
  role: 'EDITOR' | 'VIEWER'
}

@Controller('projects/:id/collaborators')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollaboratorsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.ensureCanManage(user, id)
    return this.prisma.projectCollaborator.findMany({
      where: { projectId: id },
      include: { user: { select: { id: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  @Post()
  async add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: AddCollaboratorBody) {
    await this.ensureCanManage(user, id)
    const targetUser = body.userId
      ? await this.prisma.user.findUnique({ where: { id: body.userId } })
      : body.email
        ? await this.prisma.user.findUnique({ where: { email: body.email } })
        : null
    if (!targetUser) {
      throw new ForbiddenException('User not found')
    }
    await this.prisma.projectCollaborator.upsert({
      where: { projectId_userId: { projectId: id, userId: targetUser.id } },
      update: { role: body.role },
      create: { projectId: id, userId: targetUser.id, role: body.role === 'VIEWER' ? 'VIEWER' : 'EDITOR' },
    })
    return { success: true }
  }

  @Delete(':userId')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') userId: string) {
    await this.ensureCanManage(user, id)
    await this.prisma.projectCollaborator.delete({ where: { projectId_userId: { projectId: id, userId } } })
    return { success: true }
  }

  private async ensureCanManage(user: AuthUser, projectId: string) {
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
      throw new ForbiddenException('Not authorized')
    }
    return true
  }
}
