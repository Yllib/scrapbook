import {
  Body,
  Controller,
  Get,
  UseGuards,
  NotFoundException,
  Param,
  Patch,
  Post,
  Delete,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/types';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  createProject(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.createProject(user.id, dto);
  }

  @Get()
  listProjects(@CurrentUser() user: AuthUser) {
    return this.projects.listProjects(user.id);
  }

  @Get(':id')
  async getProject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const project = await this.projects.findProjectById(id, user.id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  @Get('owner/:userId')
  @Roles('ADMIN')
  listProjectsForUser(@Param('userId') userId: string) {
    return this.projects.listProjectsForOwner(userId);
  }

  @Patch(':id')
  async updateProject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    try {
      return await this.projects.updateProject(id, user.id, dto);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Project not found');
      }
      throw error;
    }
  }

  @Delete(':id')
  async deleteProject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.projects.deleteProject(id, user.id);
    return { success: true };
  }
}
