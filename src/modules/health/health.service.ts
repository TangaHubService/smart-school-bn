import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';

export class HealthService {
  async getHealth() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        uptimeSec: Math.floor(process.uptime()),
        db: 'up',
      };
    } catch (error) {
      throw new AppError(503, 'DB_UNAVAILABLE', 'Database unavailable', {
        reason: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }
}
