import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import bcrypt from 'bcryptjs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  const config = app.get(ConfigService);
  const prisma = app.get(PrismaService);
  await ensureDefaultAdmin(config, prisma);
  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
}
void bootstrap();

async function ensureDefaultAdmin(config: ConfigService, prisma: PrismaService) {
  const email = config.get<string>('DEFAULT_ADMIN_EMAIL');
  const password = config.get<string>('DEFAULT_ADMIN_PASSWORD');
  if (!email || !password) return;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    }
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email, passwordHash, role: 'ADMIN' } });
}
