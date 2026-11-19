import { UnauthorizedException } from '@nestjs/common';

// 🪪 What is this file checking?
// Every time someone sends a request with "Bearer <token>", Passport
// decodes that token and hands the decoded info (the JwtPayload) to
// this strategy's validate() method. Our job here is just ONE extra
// check on top of Passport's own signature check: "has this exact token
// been logged out / revoked already?" We keep a denylist of revoked
// token IDs (jti) in Redis for exactly this reason.

process.env.JWT_PUBLIC_KEY = 'fake-public-key';

import { JwtStrategy } from './jwt.strategy.js';

describe('JwtStrategy', () => {
  function buildStrategy() {
    const redis = { get: jest.fn() } as any;
    return { strategy: new JwtStrategy(redis), redis };
  }

  const payload = { sub: 'user-1', role: 'CLIENT', jti: 'jti-1', iat: 0, exp: 0 } as any;

  it('accepts the token and returns the payload when it has not been revoked', async () => {
    // Why: this is the normal case for every logged-in request.
    const { strategy, redis } = buildStrategy();
    redis.get.mockResolvedValue(null);

    const result = await strategy.validate(payload);

    expect(result).toBe(payload);
    expect(redis.get).toHaveBeenCalledWith('revoked:jti-1');
  });

  it('rejects the token when it was logged out (revoked) earlier', async () => {
    // Why: logging out must actually stop the old token from working,
    // even if the token itself hasn't technically expired yet.
    const { strategy, redis } = buildStrategy();
    redis.get.mockResolvedValue('1');

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
