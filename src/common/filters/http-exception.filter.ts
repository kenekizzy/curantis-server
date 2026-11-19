import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    const message = typeof body === 'string' ? body : (body as Record<string, unknown>).message as string;
    const details = typeof body === 'object' ? (body as Record<string, unknown>).details : undefined;

    res.status(status).json({
      success: false,
      error: {
        code: exception.constructor.name.replace('Exception', '').toUpperCase(),
        message,
        details,
      },
    });
  }
}
