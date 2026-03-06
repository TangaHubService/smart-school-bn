import { v2 as cloudinary } from 'cloudinary';

import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { SignUploadInput } from './files.schemas';

export class FilesService {
  async createSignedUpload(tenantId: string, input: SignUploadInput) {
    if (
      !env.CLOUDINARY_CLOUD_NAME ||
      !env.CLOUDINARY_API_KEY ||
      !env.CLOUDINARY_API_SECRET
    ) {
      throw new AppError(
        500,
        'CLOUDINARY_NOT_CONFIGURED',
        'Cloudinary upload is not configured',
      );
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
      env.CLOUDINARY_API_SECRET,
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
}

