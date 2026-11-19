import { VerificationController } from './verification.controller.js';

// 📮 What is this file checking?
// This controller is a thin mailbox — every method just hands the
// request straight to VerificationService and returns whatever comes
// back. We just check each route calls the right service method with
// the right arguments (the service's own tests already cover the real logic).

describe('VerificationController', () => {
  function buildController() {
    const verificationService = {
      submitIdentity: jest.fn(),
      getStatus: jest.fn(),
      submitCredential: jest.fn(),
      listCredentials: jest.fn(),
      deleteCredential: jest.fn(),
    } as any;
    return { controller: new VerificationController(verificationService), verificationService };
  }

  const user = { sub: 'user-1', role: 'HW' } as any;

  it('forwards identity submissions to the service with the caller\'s id', async () => {
    const { controller, verificationService } = buildController();
    const dto = { idDocUrl: 'x', selfieUrl: 'y' } as any;

    await controller.submitIdentity(user, dto);

    expect(verificationService.submitIdentity).toHaveBeenCalledWith('user-1', dto);
  });

  it('forwards credential submissions along with the caller\'s role', async () => {
    // Why: the service needs the role to enforce "HW only" — the controller
    // must always pass it through, or that check would silently break.
    const { controller, verificationService } = buildController();
    const dto = { title: 'RN Licence' } as any;

    await controller.submitCredential(user, dto);

    expect(verificationService.submitCredential).toHaveBeenCalledWith('user-1', dto, 'HW');
  });

  it('forwards credential deletion with both the caller id and the credential id', async () => {
    const { controller, verificationService } = buildController();

    await controller.deleteCredential(user, 'cred-1');

    expect(verificationService.deleteCredential).toHaveBeenCalledWith('user-1', 'cred-1');
  });
});
