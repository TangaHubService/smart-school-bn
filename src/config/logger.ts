import pino from 'pino';

import { env } from './env';

const usePretty = env.NODE_ENV === 'development';

export const rootLogger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'smart-school-bn',
    env: env.NODE_ENV,
    version: env.APP_VERSION,
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie'],
    remove: true,
  },
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});
