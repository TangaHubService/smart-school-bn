import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';
import { env } from '../../config/env';

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

  /** Non-sensitive build / deploy metadata for dashboards and capacity demos. */
  async getPublicInfo() {
    let db = 'unknown' as string;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    const activeSessions = await prisma.refreshToken.count({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      version: env.APP_VERSION,
      commit: env.COMMIT_SHA,
      buildTime: env.BUILD_TIME,
      deployRegion: env.DEPLOY_REGION || null,
      uptimeSec: Math.floor(process.uptime()),
      db,
      activeRefreshSessions: activeSessions,
      nodeEnv: env.NODE_ENV,
    };
  }
}
