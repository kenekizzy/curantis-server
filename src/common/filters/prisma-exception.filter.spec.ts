import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter.js';

// 🗄️ What is this file checking?
// Sometimes the database itself complains — like when you try to create
// two users with the same email. Prisma gives that complaint a special
// code (like "P2002"). This filter's job is to translate those cryptic
// database codes into friendly, predictable HTTP responses so the
// frontend never has to know what "P2002" means.

function buildError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: '6.0.0',
  });
}

function buildHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as any;
  return { host, status, json };
}

describe('PrismaExceptionFilter', () => {
  it('turns a P2002 (duplicate) error into a 409 with a friendly message', () => {
    // Why: trying to register with an email that's already taken shouldn't crash the server.
    const filter = new PrismaExceptionFilter();
    const { host, status, json } = buildHost();

    filter.catch(buildError('P2002'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'DB_P2002', message: 'Resource already exists' },
    });
  });

  it('turns a P2025 (not found) error into a 404', () => {
    // Why: trying to update a booking that doesn't exist should read as "not found", not a crash.
    const filter = new PrismaExceptionFilter();
    const { host, status, json } = buildHost();

    filter.catch(buildError('P2025'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'DB_P2025', message: 'Resource not found' },
    });
  });

  it('falls back to a generic 500 "database error" for any other Prisma code', () => {
    // Why: we never want to leak raw database internals to the client for unexpected codes.
    const filter = new PrismaExceptionFilter();
    const { host, status, json } = buildHost();

    filter.catch(buildError('P9999'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'DB_P9999', message: 'Database error' },
    });
  });
});
