import { PrismaClient } from '@prisma/client';
import { Worker, Job } from 'bullmq';

const prisma = new PrismaClient();

new Worker('activityLog', async (job: Job) => {
  await prisma.auditLog.create({ data: job.data });
});
