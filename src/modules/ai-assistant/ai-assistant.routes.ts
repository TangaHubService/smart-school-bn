import { Request, Response, Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requireActiveSubscription } from '../../common/middleware/subscription-gate.middleware';
import { requireAnyPermissions, requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendSuccess } from '../../common/utils/response';
import { PERMISSIONS } from '../../constants/permissions';
import { createConversationSchema, sendAiMessageSchema, updateAiSettingsSchema } from './ai-assistant.schemas';
import { AiAssistantService } from './ai-assistant.service';
import { draftLessonPlanSchema, generateAssessmentQuestionsSchema } from './ai-teacher.schemas';
import { AiTeacherService } from './ai-teacher.service';

const service = new AiAssistantService();
const teacherService = new AiTeacherService();
export const aiAssistantRoutes = Router();

aiAssistantRoutes.use('/ai', authenticate, enforceTenant);

// School admins add their school's OpenAI key and choose limits.
const manageSettings = requirePermissions([PERMISSIONS.SCHOOL_SETUP_MANAGE]);

aiAssistantRoutes.get(
  '/ai/settings',
  manageSettings,
  asyncHandler(async (req: Request, res: Response) => sendSuccess(req, res, await service.getSettings(req.tenantId!)))
);

aiAssistantRoutes.put(
  '/ai/settings',
  manageSettings,
  validateBody(updateAiSettingsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = updateAiSettingsSchema.parse(req.body);
    return sendSuccess(req, res, await service.updateSettings(req.tenantId!, input, req.user!));
  })
);

aiAssistantRoutes.delete(
  '/ai/settings/key',
  manageSettings,
  asyncHandler(async (req: Request, res: Response) => sendSuccess(req, res, await service.removeKey(req.tenantId!, req.user!)))
);

// Teacher tools: AI drafts lesson plans and test questions. The teacher edits before saving.
aiAssistantRoutes.use(
  '/ai/teacher',
  requireActiveSubscription,
  requireAnyPermissions([PERMISSIONS.COURSES_MANAGE, PERMISSIONS.ASSESSMENTS_MANAGE])
);

aiAssistantRoutes.get(
  '/ai/teacher/status',
  asyncHandler(async (req: Request, res: Response) => sendSuccess(req, res, await teacherService.getStatus(req.tenantId!)))
);

aiAssistantRoutes.post(
  '/ai/teacher/lesson-plan-draft',
  requirePermissions([PERMISSIONS.COURSES_MANAGE]),
  validateBody(draftLessonPlanSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = draftLessonPlanSchema.parse(req.body);
    return sendSuccess(req, res, await teacherService.draftLessonPlan(req.tenantId!, input, req.user!));
  })
);

aiAssistantRoutes.post(
  '/ai/teacher/assessment-questions',
  requirePermissions([PERMISSIONS.ASSESSMENTS_MANAGE]),
  validateBody(generateAssessmentQuestionsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = generateAssessmentQuestionsSchema.parse(req.body);
    return sendSuccess(req, res, await teacherService.generateAssessmentQuestions(req.tenantId!, input, req.user!));
  })
);

// Students (anyone who can read their own courses) use the study assistant.
aiAssistantRoutes.use(
  ['/ai/status', '/ai/conversations'],
  requireActiveSubscription,
  requireAnyPermissions([PERMISSIONS.STUDENT_MY_COURSES_READ])
);

aiAssistantRoutes.get(
  '/ai/status',
  asyncHandler(async (req: Request, res: Response) => sendSuccess(req, res, await service.getStatus(req.tenantId!)))
);

aiAssistantRoutes.get(
  '/ai/conversations',
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(req, res, await service.listConversations(req.tenantId!, req.user!))
  )
);

aiAssistantRoutes.post(
  '/ai/conversations',
  validateBody(createConversationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = createConversationSchema.parse(req.body);
    return sendSuccess(req, res, await service.createConversation(req.tenantId!, input, req.user!), 201);
  })
);

aiAssistantRoutes.get(
  '/ai/conversations/:id',
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(req, res, await service.getConversation(req.tenantId!, req.params.id, req.user!))
  )
);

aiAssistantRoutes.delete(
  '/ai/conversations/:id',
  asyncHandler(async (req: Request, res: Response) =>
    sendSuccess(req, res, await service.deleteConversation(req.tenantId!, req.params.id, req.user!))
  )
);

aiAssistantRoutes.post(
  '/ai/conversations/:id/messages',
  validateBody(sendAiMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = sendAiMessageSchema.parse(req.body);
    return sendSuccess(req, res, await service.sendMessage(req.tenantId!, req.params.id, input, req.user!), 201);
  })
);
