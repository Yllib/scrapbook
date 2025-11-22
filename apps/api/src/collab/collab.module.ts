import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { CollabGateway } from './collab.gateway'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        secret: config.get<string>('AUTH_JWT_SECRET') ?? 'dev-secret-change-me',
      }),
    }),
  ],
  providers: [CollabGateway],
})
export class CollabModule {}
