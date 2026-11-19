import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: true;
  data: T;
  summary?: unknown;
  meta?: Record<string, unknown>;
}

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        const obj = data as Record<string, unknown>;
        return {
          success: true as const,
          data: (obj?.items ?? data) as T,
          ...(obj?.summary !== undefined ? { summary: obj.summary } : {}),
          meta: obj?.meta as Record<string, unknown> | undefined,
        };
      }),
    );
  }
}
