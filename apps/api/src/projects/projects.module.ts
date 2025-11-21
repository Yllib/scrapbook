import { Module } from '@nestjs/common'
import { ProjectsController } from './projects.controller'
import { ProjectsService } from './projects.service'
import { CollaboratorsController } from './collaborators.controller'
import { ShareController, PublicShareController } from './share.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController, CollaboratorsController, ShareController, PublicShareController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
