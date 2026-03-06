import { InviteStatus, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { AcceptInviteInput, InviteStaffInput } from './staff.schemas';

export class StaffService {
  private readonly auditService = new AuditService();
  private readonly emailService = new EmailService();

  async inviteStaff(
    tenantId: string,
    input: InviteStaffInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const role = await prisma.role.findFirst({
      where: {
        tenantId,
        name: input.roleName,
      },
    });

    if (!role) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found for this tenant');
    }

    if (role.name === 'SUPER_ADMIN') {
      throw new AppError(
        400,
        'INVALID_INVITE_ROLE',
        'SUPER_ADMIN role cannot be invited from school staff flow',
      );
    }

    const rawToken = randomBytes(48).toString('hex');
    const tokenHash = this.hashInviteToken(rawToken);
    const expiresAt = new Date(
      Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
    );

    let createdInviteId = '';
    const inviteLink = `${env.APP_WEB_URL.replace(/\/$/, '')}/accept-invite?token=${rawToken}`;

    try {
      const createdInvite = await prisma.$transaction(async (tx) => {
        await tx.invite.deleteMany({
          where: {
            tenantId,
            email: input.email,
            roleId: role.id,
            status: InviteStatus.PENDING,
          },
        });

        return tx.invite.create({
          data: {
            tenantId,
            email: input.email,
            roleId: role.id,
            tokenHash,
            status: InviteStatus.PENDING,
            invitedByUserId: actor.sub,
            expiresAt,
          },
        });
      });

      createdInviteId = createdInvite.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(409, 'INVITE_ALREADY_EXISTS', 'Pending invite already exists');
      }

      throw error;
    }

    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });

      await this.emailService.sendStaffInvite({
        toEmail: input.email,
        roleName: role.name,
        tenantName: tenant?.name ?? 'Smart School Rwanda',
        inviteLink,
        expiresAt,
      });
    } catch (_error) {
      if (createdInviteId) {
        await prisma.invite.update({
          where: { id: createdInviteId },
          data: {
            status: InviteStatus.REVOKED,
            revokedAt: new Date(),
          },
        });
      }

      throw new AppError(
        502,
        'INVITE_EMAIL_FAILED',
        'Failed to send invite email. Check SMTP settings and retry.',
      );
    }

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.STAFF_INVITE_CREATED,
      entity: 'Invite',
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: input.email,
        roleName: role.name,
        expiresAt,
      },
    });

    return {
      email: input.email,
      roleName: role.name,
      expiresAt,
      emailSent: true,
    };
  }

  async acceptInvite(input: AcceptInviteInput, context: RequestAuditContext) {
    const tokenHash = this.hashInviteToken(input.token);
    const invite = await prisma.invite.findUnique({
      where: { tokenHash },
      include: {
        tenant: true,
        role: true,
      },
    });

    if (!invite) {
      throw new AppError(400, 'INVITE_INVALID', 'Invite token is invalid');
    }

    if (invite.status !== InviteStatus.PENDING) {
      throw new AppError(400, 'INVITE_ALREADY_USED', 'Invite is no longer active');
    }

    if (invite.expiresAt <= new Date()) {
      await prisma.invite.update({
        where: { id: invite.id },
        data: {
          status: InviteStatus.EXPIRED,
        },
      });

      throw new AppError(400, 'INVITE_EXPIRED', 'Invite has expired');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: {
          tenantId_email: {
            tenantId: invite.tenantId,
            email: invite.email,
          },
        },
        update: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          passwordHash,
          status: 'ACTIVE',
          deletedAt: null,
        },
        create: {
          tenantId: invite.tenantId,
          email: invite.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          passwordHash,
          status: 'ACTIVE',
        },
      });

      await tx.userRole.upsert({
        where: {
          tenantId_userId_roleId: {
            tenantId: invite.tenantId,
            userId: user.id,
            roleId: invite.roleId,
          },
        },
        update: {},
        create: {
          tenantId: invite.tenantId,
          userId: user.id,
          roleId: invite.roleId,
          assignedById: invite.invitedByUserId,
        },
      });

      const acceptedInvite = await tx.invite.update({
        where: { id: invite.id },
        data: {
          status: InviteStatus.ACCEPTED,
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
        },
      });

      return {
        user,
        acceptedInvite,
      };
    });

    await this.auditService.log({
      tenantId: invite.tenantId,
      actorUserId: result.user.id,
      event: AUDIT_EVENT.STAFF_INVITE_ACCEPTED,
      entity: 'Invite',
      entityId: invite.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: invite.email,
        roleName: invite.role.name,
      },
    });

    return {
      accepted: true,
      tenantCode: invite.tenant.code,
      email: invite.email,
      phone: result.user.phone,
      role: invite.role.name,
    };
  }

  async listInvites(tenantId: string) {
    return prisma.invite.findMany({
      where: { tenantId },
      include: {
        role: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
  }

  async revokeInvite(
    tenantId: string,
    inviteId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const invite = await prisma.invite.findFirst({
      where: {
        id: inviteId,
        tenantId,
      },
      include: {
        role: true,
      },
    });

    if (!invite) {
      throw new AppError(404, 'INVITE_NOT_FOUND', 'Invite not found');
    }

    if (invite.status !== InviteStatus.PENDING) {
      throw new AppError(
        400,
        'INVITE_NOT_PENDING',
        'Only pending invites can be revoked',
      );
    }

    await prisma.invite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.STAFF_INVITE_REVOKED,
      entity: 'Invite',
      entityId: invite.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: invite.email,
        roleName: invite.role.name,
      },
    });

    return { revoked: true };
  }

  private hashInviteToken(token: string): string {
    return createHash('sha256')
      .update(`${token}:${env.JWT_REFRESH_SECRET}`)
      .digest('hex');
  }
}
