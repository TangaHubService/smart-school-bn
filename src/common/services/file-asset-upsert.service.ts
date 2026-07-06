import { FileAssetResourceType } from '@prisma/client';

import { prisma } from '../../db/prisma';

export interface FileAssetUploadInput {
  publicId: string;
  secureUrl: string;
  originalName: string;
  bytes?: number;
  format?: string;
  mimeType?: string;
  resourceType: FileAssetResourceType;
}

/**
 * Turns a raw Cloudinary upload payload into a FileAsset row, keyed by the tenant-scoped
 * publicId so re-uploading the same asset updates rather than duplicates it. Shared by every
 * module that lets a caller attach an already-uploaded file (lessons, assignments,
 * announcements, audits, chat) instead of each module hand-rolling the same upsert.
 */
export async function upsertFileAsset(
  tenantId: string,
  upload: FileAssetUploadInput,
  uploadedByUserId: string
) {
  return prisma.fileAsset.upsert({
    where: { tenantId_publicId: { tenantId, publicId: upload.publicId } },
    update: {
      secureUrl: upload.secureUrl,
      originalName: upload.originalName,
      bytes: upload.bytes,
      format: upload.format,
      mimeType: upload.mimeType,
      resourceType: upload.resourceType,
    },
    create: {
      tenantId,
      uploadedByUserId,
      publicId: upload.publicId,
      secureUrl: upload.secureUrl,
      originalName: upload.originalName,
      bytes: upload.bytes,
      format: upload.format,
      mimeType: upload.mimeType,
      resourceType: upload.resourceType,
    },
  });
}

/** Convenience wrapper for the common case of upserting a batch and collecting just the ids. */
export async function upsertFileAssetIds(
  tenantId: string,
  uploads: FileAssetUploadInput[],
  uploadedByUserId: string
): Promise<string[]> {
  if (!uploads.length) {
    return [];
  }
  const assets = await Promise.all(uploads.map(u => upsertFileAsset(tenantId, u, uploadedByUserId)));
  return assets.map(a => a.id);
}
