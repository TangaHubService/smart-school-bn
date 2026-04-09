import { InviteStatus, Prisma, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import {
  AcceptInviteInput,
  InviteStaffInput,
  ListStaffMembersQueryInput,
  UpdateStaffMemberInput,
} from './staff.schemas';

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
        name: {
          equals: input.roleName,
          mode: 'insensitive',
        },
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

  async listMembers(tenantId: string, query: ListStaffMembersQueryInput) {
    const members = await prisma.user.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: query.status,
        userRoles: {
          some: {
            role: query.roleName
              ? {
                  name: query.roleName,
                }
              : {
                  name: {
                    notIn: ['STUDENT', 'PARENT'],
                  },
                },
          },
        },
        OR: query.q
          ? [
              {
                firstName: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
              {
                lastName: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: query.q,
                  mode: 'insensitive',
                },
              },
            ]
          : undefined,
      },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
      take: 200,
    });

    return members.map((item) => this.mapStaffMember(item));
  }

  async getMember(tenantId: string, userId: string) {
    const member = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!member) {
      throw new AppError(404, 'STAFF_MEMBER_NOT_FOUND', 'Staff member not found');
    }

    return this.mapStaffMember(member);
  }

  async updateMember(
    tenantId: string,
    userId: string,
    input: UpdateStaffMemberInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const member = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!member) {
      throw new AppError(404, 'STAFF_MEMBER_NOT_FOUND', 'Staff member not found');
    }

    if (member.userRoles.some((item) => item.role.name === 'SUPER_ADMIN')) {
      throw new AppError(400, 'STAFF_MEMBER_UPDATE_FORBIDDEN', 'Super admin cannot be edited here');
    }

    if (actor.sub === member.id && input.status && input.status !== UserStatus.ACTIVE) {
      throw new AppError(400, 'STAFF_MEMBER_SELF_STATUS_FORBIDDEN', 'You cannot deactivate your own account');
    }

    const shouldRevokeRefreshTokens =
      input.status !== undefined &&
      input.status !== member.status &&
      input.status !== UserStatus.ACTIVE;

    const updated = await prisma.$transaction(async (tx) => {
      const nextMember = await tx.user.update({
        where: {
          id: member.id,
        },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          status: input.status,
        },
        include: {
          userRoles: {
            include: {
              role: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (shouldRevokeRefreshTokens) {
        await tx.refreshToken.updateMany({
          where: {
            tenantId,
            userId: member.id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }

      return nextMember;
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.STAFF_MEMBER_UPDATED,
      entity: 'User',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone,
        previousStatus: member.status,
        status: updated.status,
      },
    });

    return this.mapStaffMember(updated);
  }

  async deleteMember(
    tenantId: string,
    userId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const member = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        deletedAt: null,
      },
      include: {
        userRoles: {
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!member) {
      throw new AppError(404, 'STAFF_MEMBER_NOT_FOUND', 'Staff member not found');
    }

    if (actor.sub === member.id) {
      throw new AppError(400, 'STAFF_MEMBER_SELF_DELETE_FORBIDDEN', 'You cannot delete your own account');
    }

    if (member.userRoles.some((item) => item.role.name === 'SUPER_ADMIN')) {
      throw new AppError(400, 'STAFF_MEMBER_DELETE_FORBIDDEN', 'Super admin cannot be deleted here');
    }

    await prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({
        where: {
          tenantId,
          userId: member.id,
        },
      });

      await tx.user.update({
        where: {
          id: member.id,
        },
        data: {
          status: UserStatus.INACTIVE,
          deletedAt: new Date(),
        },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.STAFF_MEMBER_DELETED,
      entity: 'User',
      entityId: member.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: member.email,
      },
    });

    return { deleted: true };
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

  private mapStaffMember(member: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date;
    userRoles: Array<{
      role: {
        name: string;
      };
    }>;
  }) {
    const roles = [...new Set(member.userRoles.map((item) => item.role.name))].sort();

    return {
      id: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      status: member.status,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      roles,
    };
  }

  private hashInviteToken(token: string): string {
    return createHash('sha256')
      .update(`${token}:${env.JWT_REFRESH_SECRET}`)
      .digest('hex');
  }
}
