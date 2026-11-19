import { of } from 'rxjs';
import { BigIntSerializerInterceptor } from './bigint-serializer.interceptor.js';

// 💰 What is this file checking?
// Money in this app is stored as BigInt (a special "very large whole
// number" type) so we never lose a kobo to rounding mistakes. The
// problem: JavaScript's normal JSON.stringify doesn't know how to turn
// a BigInt into text — it just throws an error. This interceptor walks
// through every response right before it leaves the server and turns
// any BigInt it finds into a plain string, so the response can safely
// become JSON.

describe('BigIntSerializerInterceptor', () => {
  function run(data: unknown): Promise<unknown> {
    const interceptor = new BigIntSerializerInterceptor();
    const context = {} as any;
    const next = { handle: () => of(data) };
    return new Promise((resolve) => {
      interceptor.intercept(context, next).subscribe((result) => resolve(result));
    });
  }

  it('turns a plain BigInt value into a string', async () => {
    // Why: ₦50,000 stored as 5000000n must survive the trip to JSON.
    const result = await run(5000000n);
    expect(result).toBe('5000000');
  });

  it('turns BigInt fields inside an object into strings, recursively', async () => {
    // Why: real responses are nested objects, like a booking with a worker inside it.
    const result = await run({
      id: 'booking-1',
      totalAmountKobo: 5000000n,
      worker: { hourlyRateKobo: 500000n },
    });

    expect(result).toEqual({
      id: 'booking-1',
      totalAmountKobo: '5000000',
      worker: { hourlyRateKobo: '500000' },
    });
  });

  it('turns BigInt values inside an array into strings', async () => {
    // Why: list endpoints (like "all bookings") return arrays of these objects.
    const result = await run([{ amountKobo: 1n }, { amountKobo: 2n }]);

    expect(result).toEqual([{ amountKobo: '1' }, { amountKobo: '2' }]);
  });

  it('leaves ordinary values (numbers, strings, null) completely alone', () => {
    // Why: this interceptor should never touch data that wasn't a BigInt problem.
    return run({ name: 'Amaka', age: 30, note: null }).then((result) => {
      expect(result).toEqual({ name: 'Amaka', age: 30, note: null });
    });
  });
});
