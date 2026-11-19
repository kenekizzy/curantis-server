import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ADMIN_ROLES_KEY } from '../decorators/admin-role.decorator.js';
import type { JwtPayload } from '../types/jwt-payload.type.js';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const adminProfile = await this.prisma.adminProfile.findUnique({
      where: { userId: request.user.sub },
    });

    if (!adminProfile || !requiredRoles.includes(adminProfile.adminRole)) {
      throw new ForbiddenException('Your admin role does not permit this action');
    }
    return true;
  }
}
