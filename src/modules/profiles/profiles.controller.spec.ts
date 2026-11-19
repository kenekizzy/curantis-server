import { Role } from '@prisma/client';
import { ProfilesController } from './profiles.controller.js';

// 🚏 What is this file checking?
// This controller is a little traffic cop: depending on whether the
// logged-in user is a CLIENT or a worker (HW/HS), it sends the request
// down a different path in ProfilesService. We just check it picks the
// right path each time.

describe('ProfilesController', () => {
  function buildController() {
    const profilesService = {
      upsertClientProfile: jest.fn(),
      upsertWorkerProfile: jest.fn(),
      patchClientProfile: jest.fn(),
      patchWorkerProfile: jest.fn(),
      getOwnProfile: jest.fn(),
      getPublicWorkerProfile: jest.fn(),
    } as any;
    return { controller: new ProfilesController(profilesService), profilesService };
  }

  it('routes a CLIENT through upsertClientProfile, never the worker path', async () => {
    // Why: a client should never accidentally create a worker profile.
    const { controller, profilesService } = buildController();

    await controller.upsertProfile({ sub: 'u1', role: Role.CLIENT } as any, { fullName: 'A' });

    expect(profilesService.upsertClientProfile).toHaveBeenCalledWith('u1', { fullName: 'A' });
    expect(profilesService.upsertWorkerProfile).not.toHaveBeenCalled();
  });

  it('routes a worker (HW) through upsertWorkerProfile', async () => {
    // Why: workers fill in a different set of fields (rate, skills, etc).
    const { controller, profilesService } = buildController();

    await controller.upsertProfile({ sub: 'u2', role: Role.HW } as any, { fullName: 'B' });

    expect(profilesService.upsertWorkerProfile).toHaveBeenCalledWith('u2', { fullName: 'B' });
  });

  it('routes PATCH requests the same way as PUT — by role', async () => {
    // Why: partial updates need the same client-vs-worker split as full updates.
    const { controller, profilesService } = buildController();

    await controller.patchProfile({ sub: 'u3', role: Role.CLIENT } as any, { bio: 'x' });

    expect(profilesService.patchClientProfile).toHaveBeenCalledWith('u3', { bio: 'x' });
  });
});
