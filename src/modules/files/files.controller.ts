import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { FilesService } from './files.service';

const filesService = new FilesService();

export class FilesController {
  async signUpload(req: Request, res: Response): Promise<Response> {
    const result = await filesService.createSignedUpload(req.tenantId!, req.body);
    return sendSuccess(req, res, result);
  }
}

