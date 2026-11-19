import axios from 'axios';
import { BookingStatus } from '@prisma/client';
import { PayoutsProcessor } from './payouts.processor.js';

// 💸 What is this file checking?
// This is the job that actually sends real money to a worker's bank
// account, 24 hours after a booking completes. Because 24 hours is a
// long time, a lot can change — so before paying out, it double-checks:
//   - "did a dispute get raised on this booking while we were waiting?"
//     If yes, STOP. Don't pay.
//   - "does this worker even have a verified default bank account?"
//     If not, don't silently lose the money — throw, so BullMQ retries later.

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PayoutsProcessor', () => {
  function buildProcessor() {
    const prisma = {
      booking: { findUnique: jest.fn() },
      bankAccount: { findFirst: jest.fn() },
    } as any;
    return { processor: new PayoutsProcessor(prisma), prisma };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
  });

  it('ignores any job that is not "release-escrow"', async () => {
    const { processor, prisma } = buildProcessor();

    await processor.process({ name: 'something-else', data: {} } as any);

    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });

  it('refuses to pay out if the booking was disputed during the 24-hour wait', async () => {
    // Why: this is the whole safety reason for the 24-hour escrow window.
    const { processor, prisma } = buildProcessor();
    prisma.booking.findUnique.mockResolvedValue({ status: BookingStatus.DISPUTED });

    await processor.process({
      name: 'release-escrow',
      data: { bookingId: 'b1', workerId: 'w1', amountKobo: '900000' },
    } as any);

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('throws (so BullMQ retries later) when the worker has no verified default bank account', async () => {
    // Why: we must never silently drop a payout — better to keep retrying
    // until the worker sets up a bank account.
    const { processor, prisma } = buildProcessor();
    prisma.booking.findUnique.mockResolvedValue({ status: BookingStatus.COMPLETED });
    prisma.bankAccount.findFirst.mockResolvedValue(null);

    await expect(
      processor.process({
        name: 'release-escrow',
        data: { bookingId: 'b1', workerId: 'w1', amountKobo: '900000' },
      } as any),
    ).rejects.toThrow(/payout held/);
  });

  it('sends the payout to Paystack when everything checks out', async () => {
    // Why: the happy path — the worker finally gets paid.
    const { processor, prisma } = buildProcessor();
    prisma.booking.findUnique.mockResolvedValue({ status: BookingStatus.COMPLETED });
    prisma.bankAccount.findFirst.mockResolvedValue({ id: 'acct-1', isDefault: true, verified: true });
    mockedAxios.post.mockResolvedValue({ data: {} });

    await processor.process({
      name: 'release-escrow',
      data: { bookingId: 'b1', workerId: 'w1', amountKobo: '900000' },
    } as any);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://api.paystack.co/transfer',
      expect.objectContaining({ amount: 900000, recipient: 'acct-1' }),
      expect.any(Object),
    );
  });
});
