// 🌐 What is this file checking?
// When someone clicks "Sign in with Google", Google sends back a profile
// full of information. This strategy's only job is to pluck out the
// three things we actually care about — the Google ID, email, and name —
// and hand them to a "done" callback, in Passport's expected shape.

process.env.GOOGLE_CLIENT_ID = 'fake-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'fake-client-secret';
process.env.GOOGLE_CALLBACK_URL = 'http://localhost/callback';

import { GoogleStrategy } from './google.strategy.js';

describe('GoogleStrategy', () => {
  it('extracts googleSub, email, and name from the Google profile and hands them to done()', () => {
    // Why: this is the only piece of translation between "Google's format"
    // and "the shape our AuthService.loginWithGoogle expects".
    const strategy = new GoogleStrategy();
    const done = jest.fn();
    const profile = {
      _json: { sub: 'google-sub-123', email: 'amaka@example.com', name: 'Amaka' },
    } as any;

    strategy.validate('access-token', 'refresh-token', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      googleSub: 'google-sub-123',
      email: 'amaka@example.com',
      name: 'Amaka',
    });
  });
});
