import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';

const prisma = new PrismaClient();

new Worker('activityLog', async job => {
  await prisma.auditLog.create({ data: job.data });
});
