import { WorkerAccountController } from './worker-account.controller.js';

// 💵 What is this file checking?
// This controller is the worker's "my money" page — earnings and bank
// accounts. It's a thin mailbox to PaymentsService (which has its own
// detailed tests). We just make sure each route always includes the
// logged-in worker's own id, so nobody can accidentally see or touch
// somebody else's money.

describe('WorkerAccountController', () => {
  function buildController() {
    const paymentsService = {
      getEarnings: jest.fn(),
      listBankAccounts: jest.fn(),
      addBankAccount: jest.fn(),
      setDefaultAccount: jest.fn(),
      deleteAccount: jest.fn(),
    } as any;
    return { controller: new WorkerAccountController(paymentsService), paymentsService };
  }

  const user = { sub: 'worker-1' } as any;

  it('fetches earnings for the currently logged-in worker only', () => {
    const { controller, paymentsService } = buildController();

    controller.getEarnings(user);

    expect(paymentsService.getEarnings).toHaveBeenCalledWith('worker-1');
  });

  it('adds a bank account using the worker\'s own id, plus the bank code and account number', () => {
    const { controller, paymentsService } = buildController();

    controller.addBankAccount({ bankCode: '058', accountNumber: '0123456789' } as any, user);

    expect(paymentsService.addBankAccount).toHaveBeenCalledWith('worker-1', '058', '0123456789');
  });

  it('deletes a bank account by its own id, scoped to the calling worker', () => {
    const { controller, paymentsService } = buildController();

    controller.deleteAccount('account-1', user);

    expect(paymentsService.deleteAccount).toHaveBeenCalledWith('worker-1', 'account-1');
  });
});
