import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { JwtPayload, AuthUser } from './types'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('AUTH_JWT_SECRET') ?? 'dev-secret-change-me',
    })
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) {
      throw new Error('Unauthorized')
    }
    const defaultAdminEmail = this.config.get<string>('DEFAULT_ADMIN_EMAIL')
    if (defaultAdminEmail && user.email === defaultAdminEmail && user.role !== 'ADMIN') {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
      user.role = 'ADMIN'
    }
    return { id: user.id, email: user.email, role: user.role as AuthUser['role'] }
  }
}
