import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto, SignUpDto } from './dto/auth.dto'
import { AuthUser, JwtPayload } from './types'
import bcrypt from 'bcryptjs'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async signUp(dto: SignUpDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) {
      throw new ConflictException('Email already registered')
    }
    const passwordHash = await bcrypt.hash(dto.password, 10)
    const role = this.isDefaultAdmin(dto.email) ? 'ADMIN' : 'USER'
    const user = await this.prisma.user.create({ data: { email: dto.email, passwordHash, role } })
    const token = this.signToken(user.id, user.email, user.role)
    return { token, user: { id: user.id, email: user.email, role: user.role } }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) {
      throw new UnauthorizedException('Invalid credentials')
    }
    const match = await bcrypt.compare(dto.password, user.passwordHash)
    if (!match) {
      throw new UnauthorizedException('Invalid credentials')
    }
    if (this.isDefaultAdmin(user.email) && user.role !== 'ADMIN') {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
      user.role = 'ADMIN'
    }
    const token = this.signToken(user.id, user.email, user.role)
    return { token, user: { id: user.id, email: user.email, role: user.role } }
  }

  async me(user: AuthUser) {
    return user
  }

  private signToken(userId: string, email: string, role: AuthUser['role']): string {
    const payload: JwtPayload = { sub: userId, email, role }
    return this.jwt.sign(payload)
  }

  private isDefaultAdmin(email: string): boolean {
    const adminEmail = this.config.get<string>('DEFAULT_ADMIN_EMAIL')
    return Boolean(adminEmail && email.toLowerCase() === adminEmail.toLowerCase())
  }
}
