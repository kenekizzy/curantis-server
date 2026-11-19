import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const statusMap: Record<string, number> = {
      P2002: 409,
      P2025: 404,
      P2003: 400,
    };

    const status = statusMap[exception.code] ?? 500;
    const message =
      exception.code === 'P2002'
        ? 'Resource already exists'
        : exception.code === 'P2025'
          ? 'Resource not found'
          : 'Database error';

    res.status(status).json({
      success: false,
      error: { code: `DB_${exception.code}`, message },
    });
  }
}
