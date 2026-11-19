import { v2 as cloudinary } from 'cloudinary';
import { StorageService } from './storage.service.js';

// 🧸 What is this file checking?
// Imagine StorageService is a helpful robot at the front desk of a photo
// album (Cloudinary). Before anyone can drop off a picture, video, or
// document, the robot hands them a special signed permission slip —
// our server never touches the actual file, it just approves the drop-off.
// These tests make sure the robot:
//   1. writes a correctly-signed permission slip for good files
//   2. says "no thank you" to files that are the wrong kind or too big
//   3. correctly figures out whether a file is a photo, a video, or a document

const ORIGINAL_ENV = process.env;

describe('StorageService', () => {
  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: 'demo-key',
      CLOUDINARY_API_SECRET: 'demo-secret',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('getUploadSignature', () => {
    it('refuses a file type that is not on the allowed list', async () => {
      // Why: we never want someone sneaking in a .exe pretending to be a photo.
      const storage = new StorageService();

      await expect(
        storage.getUploadSignature({
          folder: 'avatars',
          mimeType: 'application/x-msdownload',
          fileSize: 1000,
          allowedMimeTypes: ['image/jpeg', 'image/png'],
          maxSizeBytes: 5 * 1024 * 1024,
        }),
      ).rejects.toThrow('Unsupported file type');
    });

    it('refuses a file that is bigger than the allowed size', async () => {
      // Why: a huge file could slow things down or cost too much to store.
      const storage = new StorageService();

      await expect(
        storage.getUploadSignature({
          folder: 'avatars',
          mimeType: 'image/jpeg',
          fileSize: 10 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg'],
          maxSizeBytes: 5 * 1024 * 1024,
        }),
      ).rejects.toThrow('File exceeds 5MB limit');
    });

    it('hands back a correctly signed permission slip for a valid photo', async () => {
      // Why: this is the normal, everyday case that must just work.
      const storage = new StorageService();

      const result = await storage.getUploadSignature({
        folder: 'avatars/user-1',
        mimeType: 'image/png',
        fileSize: 1024,
        allowedMimeTypes: ['image/png'],
        maxSizeBytes: 5 * 1024 * 1024,
        publicId: 'user-1/avatar.png',
      });

      expect(result.resourceType).toBe('image');
      expect(result.folder).toBe('avatars/user-1');
      expect(result.publicId).toBe('user-1/avatar.png');
      expect(result.cloudName).toBe('demo-cloud');
      expect(result.apiKey).toBe('demo-key');
      expect(result.uploadUrl).toBe(
        'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
      );
      expect(typeof result.signature).toBe('string');
      expect(result.signature.length).toBeGreaterThan(0);

      // The signature must be the exact same one Cloudinary itself would
      // compute for these params — otherwise Cloudinary would reject the upload.
      const expectedSignature = cloudinary.utils.api_sign_request(
        { timestamp: result.timestamp, folder: 'avatars/user-1', public_id: 'user-1/avatar.png' },
        'demo-secret',
      );
      expect(result.signature).toBe(expectedSignature);
    });

    it('recognises a video file and points uploads at the video endpoint', async () => {
      // Why: Cloudinary needs to know upfront whether it's storing a photo or a video.
      const storage = new StorageService();

      const result = await storage.getUploadSignature({
        folder: 'chat/conversation-1',
        mimeType: 'video/mp4',
        fileSize: 1024,
        allowedMimeTypes: ['video/mp4'],
        maxSizeBytes: 50 * 1024 * 1024,
      });

      expect(result.resourceType).toBe('video');
      expect(result.uploadUrl).toBe(
        'https://api.cloudinary.com/v1_1/demo-cloud/video/upload',
      );
    });

    it('treats anything that is not image or video as a "raw" document', async () => {
      // Why: PDFs, Word docs, etc. all go through Cloudinary's generic "raw" bucket.
      const storage = new StorageService();

      const result = await storage.getUploadSignature({
        folder: 'credentials',
        mimeType: 'application/pdf',
        fileSize: 1024,
        allowedMimeTypes: ['application/pdf'],
        maxSizeBytes: 5 * 1024 * 1024,
      });

      expect(result.resourceType).toBe('raw');
    });
  });

  describe('buildPublicId', () => {
    it('builds a tidy, unique-looking path from a user id and filename', () => {
      // Why: this is what keeps one user's files from colliding with another's.
      const storage = new StorageService();

      const publicId = storage.buildPublicId('user-42', 'my photo.png');

      expect(publicId).toMatch(/^user-42\/\d+-my_photo\.png$/);
    });

    it('replaces unsafe characters in the filename so the path stays clean', () => {
      // Why: filenames can contain spaces, emoji, or symbols Cloudinary won't like.
      const storage = new StorageService();

      const publicId = storage.buildPublicId('user-1', 'weird file!@#.pdf');

      expect(publicId).toMatch(/^user-1\/\d+-weird_file___\.pdf$/);
    });
  });
});
