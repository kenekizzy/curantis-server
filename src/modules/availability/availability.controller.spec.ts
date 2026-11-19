import { AvailabilityController } from './availability.controller.js';

// 📅 What is this file checking?
// Most of this controller is a plain mailbox to AvailabilityService
// (already tested). The one real bit of translation work it does is
// turning the plain date strings from the request body (like
// "2026-01-01") into real JavaScript Date objects before handing them
// to the service — that's the only thing worth checking here.

describe('AvailabilityController', () => {
  it('converts the startDate/endDate strings into real Date objects before calling the service', async () => {
    const availabilityService = { addBlock: jest.fn() } as any;
    const controller = new AvailabilityController(availabilityService);
    const user = { sub: 'user-1' } as any;

    await controller.addBlock(user, {
      startDate: '2026-01-01',
      endDate: '2026-01-10',
      reason: 'Leave',
    } as any);

    const [userId, startDate, endDate, reason] = availabilityService.addBlock.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(startDate).toBeInstanceOf(Date);
    expect(endDate).toBeInstanceOf(Date);
    expect(reason).toBe('Leave');
  });
});
