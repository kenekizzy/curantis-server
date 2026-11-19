import { Injectable, BadRequestException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

export type CloudinaryResourceType = 'image' | 'video' | 'raw';

export interface UploadSignatureOptions {
  folder: string;
  mimeType: string;
  fileSize: number;
  maxSizeBytes: number;
  allowedMimeTypes: string[];
  publicId?: string;
}

@Injectable()
export class StorageService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  /**
   * Returns signed params for the client to upload a file directly to Cloudinary
   * (mirrors the old S3 presigned-PUT flow — the server never touches the bytes).
   * The client's own upload response carries the final `secure_url`.
   */
  async getUploadSignature(opts: UploadSignatureOptions) {
    if (!opts.allowedMimeTypes.includes(opts.mimeType)) {
      throw new BadRequestException('Unsupported file type');
    }
    if (opts.fileSize > opts.maxSizeBytes) {
      throw new BadRequestException(
        `File exceeds ${Math.floor(opts.maxSizeBytes / (1024 * 1024))}MB limit`,
      );
    }

    const resourceType = this.resolveResourceType(opts.mimeType);
    const timestamp = Math.round(Date.now() / 1000);
    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder: opts.folder,
      ...(opts.publicId ? { public_id: opts.publicId } : {}),
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET!,
    );

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
      signature,
      timestamp,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      folder: opts.folder,
      publicId: opts.publicId,
      resourceType,
    };
  }

  buildPublicId(userId: string, filename: string): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return `${userId}/${Date.now()}-${sanitized}`;
  }

  private resolveResourceType(mimeType: string): CloudinaryResourceType {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    return 'raw';
  }
}
