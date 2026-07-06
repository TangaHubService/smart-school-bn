/**
 * PDF attachments are only ever fetched through the authenticated /files/:id/stream
 * endpoint (see files.service.ts#streamFile) so the underlying storage URL never reaches
 * the browser. Callers should send null instead of the real secureUrl whenever this
 * returns true. Keyed off the file's actual mimeType (not a caller-declared content type)
 * so the check can't be bypassed by mislabeling a lesson/assignment's content type.
 */
export function isProtectedPdfAsset(mimeType: string | null | undefined): boolean {
  return mimeType === 'application/pdf';
}
