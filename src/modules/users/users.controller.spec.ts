import { UsersController } from './users.controller.js';

// 🖼️ What is this file checking?
// This controller does two things: it hands back "my profile" info, and
// it asks StorageService for a permission slip to upload a new avatar
// photo. The interesting bit worth testing is the avatar part — making
// sure the right sized/typed limits get sent to StorageService, and that
// the file extension in the storage path actually matches the photo type
// the user is uploading (a bug we fixed during the Cloudinary migration:
// it used to always assume ".jpg" even for PNG/WebP uploads).

describe('UsersController', () => {
  function buildController() {
    const usersService = { findById: jest.fn(), update: jest.fn() } as any;
    const storageService = {
      getUploadSignature: jest.fn().mockResolvedValue({ uploadUrl: 'https://cloudinary/upload' }),
      buildPublicId: jest.fn((userId: string, filename: string) => `${userId}/123-${filename}`),
    } as any;
    return {
      controller: new UsersController(usersService, storageService),
      usersService,
      storageService,
    };
  }

  const user = { sub: 'user-1', role: 'CLIENT', jti: 'j', iat: 0, exp: 0 } as any;

  it('asks for a jpeg-shaped upload slip when the avatar is a JPEG', async () => {
    // Why: the stored filename's extension should match the real photo type.
    const { controller, storageService } = buildController();

    await controller.getAvatarUploadUrl(user, { mimeType: 'image/jpeg', fileSize: 1000 } as any);

    expect(storageService.buildPublicId).toHaveBeenCalledWith('user-1', 'avatar.jpg');
  });

  it('asks for a png-shaped upload slip when the avatar is a PNG (not hardcoded to .jpg)', async () => {
    // Why: this is exactly the bug that used to exist — every avatar got
    // named "avatar.jpg" even when the actual photo was a PNG or WebP.
    const { controller, storageService } = buildController();

    await controller.getAvatarUploadUrl(user, { mimeType: 'image/png', fileSize: 1000 } as any);

    expect(storageService.buildPublicId).toHaveBeenCalledWith('user-1', 'avatar.png');
  });

  it('only allows small image files for avatars (5MB, images only)', async () => {
    // Why: an avatar is a tiny profile photo — no reason to allow huge files or videos.
    const { controller, storageService } = buildController();

    await controller.getAvatarUploadUrl(user, { mimeType: 'image/webp', fileSize: 2000 } as any);

    expect(storageService.getUploadSignature).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'avatars',
        maxSizeBytes: 5 * 1024 * 1024,
        allowedMimeTypes: expect.arrayContaining(['image/jpeg', 'image/png', 'image/webp']),
      }),
    );
  });
});
