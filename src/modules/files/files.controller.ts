import { Readable } from 'node:stream';

import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { FilesService } from './files.service';

const filesService = new FilesService();

export class FilesController {
  async signUpload(req: Request, res: Response): Promise<Response> {
    const result = await filesService.createSignedUpload(req.tenantId!, req.body);
    return sendSuccess(req, res, result);
  }

  async getFileViewUrl(req: Request, res: Response): Promise<Response> {
    const result = await filesService.getFileViewUrl(req.tenantId!, req.params.assetId, req.user!);
    return sendSuccess(req, res, result);
  }

  /**
   * Streams file bytes server-side (never the underlying storage URL) so PDF
   * learning resources cannot be lifted straight out of an API response.
   */
  async streamFile(req: Request, res: Response): Promise<void> {
    const { body, mimeType, originalName } = await filesService.streamFile(
      req.tenantId!,
      req.params.assetId
    );

    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${originalName.replace(/["\r\n]/g, '')}"`
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    Readable.fromWeb(body as any).pipe(res);
  }
}
