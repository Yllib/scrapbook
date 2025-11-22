import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AssetsModule } from './assets/assets.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { ProjectsModule } from './projects/projects.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CollabModule } from './collab/collab.module';

const rootEnvDir = path.resolve(__dirname, '../../..');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(rootEnvDir, '.env.local'),
        path.join(rootEnvDir, '.env'),
      ],
    }),
    PrismaModule,
    StorageModule,
    AssetsModule,
    ProjectsModule,
    AuthModule,
    UsersModule,
    CollabModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
