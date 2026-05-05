import { NextFunction, Request, Response } from 'express';
import { Queue } from 'bullmq';

// Queue for async activity logging (fire‑and‑forget)
const activityQueue = new Queue('activityLog');

export const activityLogger = async (req: Request, res: Response, next: NextFunction) => {
  // Attach helper to request for later use in controllers
  (req as any).logActivity = async ({
    user,
    actionType,
    module,
    description,
    recordId,
    oldValue,
    newValue,
    success = true,
  }: {
    user: { id: number; fullName?: string; role?: string; schoolName?: string };
    actionType: string;
    module: string;
    description: string;
    recordId?: number;
    oldValue?: unknown;
    newValue?: unknown;
    success?: boolean;
  }) => {
    await activityQueue.add('log', {
      userId: user.id,
      userName: user.fullName ?? null,
      role: user.role ?? null,
      schoolName: user.schoolName ?? null,
      actionType,
      module,
      description,
      recordId: recordId ?? null,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      ipAddress: req.ip,
      device: req.headers['user-agent'] ?? '',
      status: success ? 'SUCCESS' : 'FAILED',
      sessionId: (req as any).session?.id ?? null,
    });
  };
  next();
};
