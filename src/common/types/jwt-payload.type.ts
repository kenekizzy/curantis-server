import type { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}
