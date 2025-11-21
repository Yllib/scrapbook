import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import bcrypt from 'bcryptjs'
import { CreateProjectDto } from '../projects/dto/create-project.dto'
import { UpdateProjectDto } from '../projects/dto/update-project.dto'

interface UpdateUserDto {
  role?: 'USER' | 'ADMIN'
  password?: string
}

interface CreateUserDto {
  email: string
  password: string
  role?: 'USER' | 'ADMIN'
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles('ADMIN')
  listUsers() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  @Get(':id/projects')
  @Roles('ADMIN')
  listUserProjects(@Param('id') id: string) {
    return this.prisma.project.findMany({ where: { ownerId: id } })
  }

  @Post(':id/projects')
  @Roles('ADMIN')
  async createProjectForUser(@Param('id') id: string, @Body() dto: CreateProjectDto) {
    const trimmed = dto.name?.trim()
    return this.prisma.project.create({
      data: {
        name: trimmed && trimmed.length > 0 ? trimmed : 'Untitled Project',
        ownerId: id,
        scene: toJsonValue(dto.scene),
        collaborators: { create: { userId: id, role: 'OWNER' } },
      },
    })
  }

  @Patch(':id/projects/:projectId')
  @Roles('ADMIN')
  async updateProjectForUser(@Param('id') id: string, @Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ownerId: id } })
    if (!project) throw new NotFoundException('Project not found for user')

    const data: Prisma.ProjectUpdateInput = {}
    if (dto.name !== undefined) {
      const trimmed = dto.name?.trim()
      data.name = trimmed && trimmed.length > 0 ? trimmed : 'Untitled Project'
    }
    if (dto.scene !== undefined) {
      data.scene = toJsonValue(dto.scene)
    }

    return this.prisma.project.update({ where: { id: projectId }, data })
  }

  @Delete(':id/projects/:projectId')
  @Roles('ADMIN')
  async deleteProjectForUser(@Param('id') id: string, @Param('projectId') projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ownerId: id } })
    if (!project) throw new NotFoundException('Project not found for user')
    await this.prisma.project.delete({ where: { id: projectId } })
    return { success: true }
  }

  @Post()
  @Roles('ADMIN')
  async createUser(@Body() dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10)
    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: dto.role ?? 'USER',
      },
      select: { id: true, email: true, role: true, createdAt: true },
    })
  }

  @Patch(':id')
  @Roles('ADMIN')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const data: any = {}
    if (dto.role) data.role = dto.role
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10)
    return this.prisma.user.update({ where: { id }, data, select: { id: true, email: true, role: true, createdAt: true } })
  }

  @Delete(':id')
  @Roles('ADMIN')
  async deleteUser(@Param('id') id: string) {
    await this.prisma.user.delete({ where: { id } })
    return { success: true }
  }
}

const toJsonValue = (
  value: Record<string, unknown> | null | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue => {
  if (value === null || value === undefined) {
    return Prisma.JsonNull
  }
  return value as Prisma.InputJsonValue
}
