import { Router } from 'express';

import { MetaController } from './meta.controller';

const metaController = new MetaController();

export const metaRoutes = Router();

metaRoutes.get('/version', (req, res) => metaController.getVersion(req, res));
