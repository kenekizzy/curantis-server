import { of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor.js';

// 🎁 What is this file checking?
// Imagine every controller hands back its answer in a random box shape —
// sometimes a plain object, sometimes a list with pagination info stuck
// to it. ResponseTransformInterceptor is the wrapping station: it takes
// whatever comes out and always wraps it the same way before it reaches
// the client:
//   { success: true, data: <the actual answer>, meta: <pagination info, if any> }
// so every frontend can always unwrap responses the exact same way.

describe('ResponseTransformInterceptor', () => {
  function run(data: unknown): Promise<unknown> {
    const interceptor = new ResponseTransformInterceptor();
    const context = {} as any;
    const next = { handle: () => of(data) };
    return new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe((result) => resolve(result));
    });
  }

  it('wraps a plain object as { success: true, data: <object> }', async () => {
    // Why: this is the everyday case — a controller returns one booking, one user, etc.
    const result = await run({ id: 'booking-1', status: 'PENDING' });

    expect(result).toEqual({
      success: true,
      data: { id: 'booking-1', status: 'PENDING' },
      meta: undefined,
    });
  });

  it('unwraps { items, meta } shapes so "items" becomes "data" and "meta" is kept', async () => {
    // Why: list endpoints (like search results) return items + pagination info together.
    const result = await run({
      items: [{ id: '1' }, { id: '2' }],
      meta: { nextCursor: 'abc' },
    });

    expect(result).toEqual({
      success: true,
      data: [{ id: '1' }, { id: '2' }],
      meta: { nextCursor: 'abc' },
    });
  });

  it('passes through primitive results (like a plain string or number) unchanged as data', async () => {
    // Why: not every endpoint returns an object — some just confirm success.
    const result = await run('ok');

    expect(result).toEqual({ success: true, data: 'ok', meta: undefined });
  });
});
