import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProject(userId: string, dto: CreateProjectDto): Promise<Project> {
    const name = dto.name?.trim();
    return this.prisma.project.create({
      data: {
        name: name && name.length > 0 ? name : 'Untitled Project',
        scene: toJsonValue(dto.scene),
        ownerId: userId,
        collaborators: { create: { userId, role: 'OWNER' } },
      },
    });
  }

  findProjectById(id: string, userId: string): Promise<Project | null> {
    return this.prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { collaborators: { some: { userId } } },
        ],
      },
    });
  }

  async listProjects(ownerId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: {
        OR: [
          { ownerId },
          { collaborators: { some: { userId: ownerId } } },
        ],
      },
      include: {
        owner: { select: { id: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async listProjectsForOwner(ownerId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async updateProject(id: string, userId: string, dto: UpdateProjectDto): Promise<Project> {
    const existing = await this.prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { collaborators: { some: { userId } } },
        ],
      },
    });
    if (!existing) {
      throw new NotFoundException('Project not found');
    }
    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name?.trim();
      data.name = trimmed && trimmed.length > 0 ? trimmed : 'Untitled Project';
    }
    if (dto.scene !== undefined) {
      data.scene = toJsonValue(dto.scene);
    }
    return this.prisma.project.update({ where: { id }, data });
  }

  async deleteProject(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.project.findFirst({
      where: {
        id,
        OR: [
          { ownerId: userId },
          { collaborators: { some: { userId, role: { in: ['OWNER'] } } } },
        ],
      },
    });
    if (!existing) {
      throw new NotFoundException('Project not found');
    }
    await this.prisma.project.delete({ where: { id } });
  }
}

const toJsonValue = (
  value: Record<string, unknown> | null | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue => {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
};
