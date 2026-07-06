import { v2 as cloudinary } from 'cloudinary';

import { JwtUser } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { SignUploadInput } from './files.schemas';

export class FilesService {
  async createSignedUpload(tenantId: string, input: SignUploadInput) {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw new AppError(500, 'CLOUDINARY_NOT_CONFIGURED', 'Cloudinary upload is not configured');
    }

    const tenant = await prisma.tenant.findUnique({
      where: {
        id: tenantId,
      },
      select: {
        code: true,
      },
    });

    if (!tenant) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Tenant not found');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `${env.CLOUDINARY_FOLDER_PREFIX}/${tenant.code}/${input.purpose}`;
    const signature = cloudinary.utils.api_sign_request(
      {
        folder,
        timestamp,
      },
      env.CLOUDINARY_API_SECRET
    );

    return {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      timestamp,
      folder,
      signature,
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
    };
  }

  async getFileViewUrl(tenantId: string, assetId: string, _actor: JwtUser) {
    const asset = await prisma.fileAsset.findFirst({
      where: { id: assetId, tenantId },
    });
    if (!asset) {
      throw new AppError(404, 'FILE_NOT_FOUND', 'File not found');
    }
    const secureUrl = asset.secureUrl.includes('cloudinary')
      ? asset.secureUrl.replace('/upload/', '/upload/fl_attachment:false/')
      : asset.secureUrl;
    return {
      id: asset.id,
      secureUrl,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
    };
  }

  /**
   * Fetches the file bytes server-side so the underlying storage URL (Cloudinary)
   * is never sent to the browser. Used to protect PDF learning resources from
   * being copied straight out of API responses.
   */
  async streamFile(tenantId: string, assetId: string) {
    const asset = await prisma.fileAsset.findFirst({
      where: { id: assetId, tenantId },
    });
    if (!asset) {
      throw new AppError(404, 'FILE_NOT_FOUND', 'File not found');
    }

    const upstream = await fetch(asset.secureUrl);
    if (!upstream.ok || !upstream.body) {
      throw new AppError(502, 'FILE_FETCH_FAILED', 'Could not retrieve the file for streaming');
    }

    return {
      body: upstream.body,
      mimeType: asset.mimeType ?? 'application/octet-stream',
      originalName: asset.originalName,
    };
  }
}
