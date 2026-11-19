import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';

// 📦 What is this file checking?
// When something goes wrong in the app (like "you typed a bad email"),
// NestJS throws an "exception" — a little error box. HttpExceptionFilter
// is the person who catches that box before it reaches the user, opens
// it up, and repacks it into our app's standard error envelope:
//   { success: false, error: { code, message, details } }
// so every single error looks the same shape no matter where it came from.

describe('HttpExceptionFilter', () => {
  function buildHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as any;
    return { host, status, json };
  }

  it('repacks a simple string error message into the standard envelope', () => {
    // Why: some exceptions only carry a plain string message.
    const filter = new HttpExceptionFilter();
    const { host, status, json } = buildHost();
    const exception = new NotFoundException('Booking not found');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'NOTFOUND', message: 'Booking not found', details: undefined },
    });
  });

  it('pulls out both the message and extra details when the exception carries an object', () => {
    // Why: validation errors often attach a "details" list of what went wrong per field.
    const filter = new HttpExceptionFilter();
    const { host, status, json } = buildHost();
    const exception = new BadRequestException({
      message: 'Validation failed',
      details: ['email must be valid'],
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'BADREQUEST',
        message: 'Validation failed',
        details: ['email must be valid'],
      },
    });
  });
});
