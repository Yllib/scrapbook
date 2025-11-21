export interface JwtPayload {
  sub: string
  email: string
  role: 'USER' | 'ADMIN'
}

export interface AuthUser {
  id: string
  email: string
  role: 'USER' | 'ADMIN'
}
