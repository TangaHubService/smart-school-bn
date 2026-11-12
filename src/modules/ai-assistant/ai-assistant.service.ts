import { AiMessageRole } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { decryptSecret, encryptSecret } from '../../common/utils/secret-box';
import { JwtUser } from '../../common/types/auth.types';
import { env } from '../../config/env';
import { rootLogger } from '../../config/logger';
import { prisma } from '../../db/prisma';
import { LmsService } from '../lms/lms.service';
import { CreateConversationInput, SendAiMessageInput, UpdateAiSettingsInput } from './ai-assistant.schemas';

type AiConfig = { apiKey: string | null; model: string; enabled: boolean; dailyLimit: number; source: 'school' | 'platform' | 'none' };

const log = rootLogger.child({ module: 'ai-assistant' });

/** How much course text goes to the model (keeps cost and latency predictable). */
const MAX_COURSE_CONTEXT_CHARS = 12_000;
/** How many earlier messages are sent back to the model for context. */
const HISTORY_MESSAGES = 20;

const MODE_PROMPTS: Record<Exclude<SendAiMessageInput['mode'], 'ask'>, string> = {
  summarize:
    'Summarize this course for me. Start with a one-paragraph overview, then list the key ideas lesson by lesson as short bullet points, and end with the 3 most important things to remember.',
  examples:
    'Give me clear, worked examples for the main concepts in this course. For each concept: name it, explain it in one or two simple sentences, then show an everyday example (preferably from life in Rwanda) and a step-by-step worked example.',
  quiz:
    'Quiz me on this course. Ask 5 short questions one after another (mix multiple choice and short answer), numbered. Do not show the answers yet; tell me to reply with my answers so you can check them.',
};

const SYSTEM_PROMPT = `You are "Smart Study Assistant", a friendly and patient tutor for secondary and primary school students in Rwanda using the Smart School platform.

How to help:
- Explain ideas simply, step by step, using short paragraphs and everyday examples (life in Rwanda when it helps).
- When asked to summarize, use headings and bullet points. When asked for examples, give worked, step-by-step examples.
- For homework or exam-style questions, guide the student to the answer and explain the reasoning instead of only giving the final answer.
- If course material is provided below, base course answers on it and say when something goes beyond it.
- Students may also ask general questions on any school subject or study skills; answer those helpfully too.
- Reply in the language the student writes in (English, Kinyarwanda or French).
- Format answers in Markdown. Use LaTeX-free plain notation for maths (e.g. x^2, 3/4).
- Keep everything age-appropriate. Politely decline requests that are harmful, unsafe, or not suitable for a school setting.
- Never ask for or reveal personal information.`;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export class AiAssistantService {
  private readonly lms = new LmsService();

  /**
   * The school's own key (added by its admin) wins; the platform key in .env is only a
   * fallback. A school admin can also switch the assistant off for their school.
   */
  private async resolveConfig(tenantId: string): Promise<AiConfig> {
    const settings = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
    const schoolKey = settings?.openaiApiKeyEncrypted ? decryptSecret(settings.openaiApiKeyEncrypted) : null;
    if (settings?.openaiApiKeyEncrypted && !schoolKey) {
      log.error({ tenantId }, 'Stored OpenAI key could not be decrypted (encryption key changed?)');
    }
    const apiKey = schoolKey ?? env.OPENAI_API_KEY ?? null;
    return {
      apiKey,
      model: settings?.model ?? env.OPENAI_MODEL,
      enabled: (settings?.enabled ?? true) && Boolean(apiKey),
      dailyLimit: settings?.dailyLimitPerStudent ?? env.AI_ASSISTANT_DAILY_LIMIT,
      source: schoolKey ? 'school' : env.OPENAI_API_KEY ? 'platform' : 'none',
    };
  }

  async getStatus(tenantId: string) {
    const config = await this.resolveConfig(tenantId);
    return { enabled: config.enabled, model: config.model, dailyLimit: config.dailyLimit };
  }

  // ---- School admin settings -------------------------------------------------

  async getSettings(tenantId: string) {
    const settings = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
    const config = await this.resolveConfig(tenantId);
    return {
      hasKey: Boolean(settings?.openaiApiKeyEncrypted),
      keyLast4: settings?.keyLast4 ?? null,
      model: config.model,
      enabled: settings?.enabled ?? true,
      dailyLimitPerStudent: config.dailyLimit,
      usingPlatformKey: config.source === 'platform',
      updatedAt: settings?.updatedAt ?? null,
    };
  }

  async updateSettings(tenantId: string, input: UpdateAiSettingsInput, actor: JwtUser) {
    const current = await prisma.tenantAiSettings.findUnique({ where: { tenantId } });
    const model = input.model ?? current?.model ?? env.OPENAI_MODEL;
    const data: Record<string, unknown> = { updatedByUserId: actor.sub };
    if (input.model !== undefined) data.model = input.model;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.dailyLimitPerStudent !== undefined) data.dailyLimitPerStudent = input.dailyLimitPerStudent;

    if (input.apiKey) {
      // Check the key works (and can use the chosen model) before saving it.
      await this.verifyKey(input.apiKey, model);
      data.openaiApiKeyEncrypted = encryptSecret(input.apiKey);
      data.keyLast4 = input.apiKey.slice(-4);
    } else if (input.model !== undefined) {
      const key = current?.openaiApiKeyEncrypted ? decryptSecret(current.openaiApiKeyEncrypted) : null;
      if (key) await this.verifyKey(key, model);
    }

    await prisma.tenantAiSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    log.info({ tenantId, actorUserId: actor.sub, keyChanged: Boolean(input.apiKey) }, 'AI settings updated');
    return this.getSettings(tenantId);
  }

  async removeKey(tenantId: string, actor: JwtUser) {
    await prisma.tenantAiSettings.updateMany({
      where: { tenantId },
      data: { openaiApiKeyEncrypted: null, keyLast4: null, updatedByUserId: actor.sub },
    });
    log.info({ tenantId, actorUserId: actor.sub }, 'AI key removed');
    return this.getSettings(tenantId);
  }

  /** Asks OpenAI about the model with this key: proves the key is valid and has access. */
  private async verifyKey(apiKey: string, model: string) {
    let response: Response;
    try {
      response = await fetch(`${env.OPENAI_BASE_URL}/models/${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError(502, 'AI_UNAVAILABLE', 'Could not reach OpenAI to check the key. Please try again.');
    }
    if (response.status === 401) {
      throw new AppError(400, 'AI_KEY_INVALID', 'OpenAI rejected this key. Check that you copied the whole key.');
    }
    if (response.status === 404) {
      throw new AppError(400, 'AI_MODEL_UNAVAILABLE', `This key cannot use the model "${model}".`);
    }
    if (!response.ok) {
      throw new AppError(400, 'AI_KEY_CHECK_FAILED', `OpenAI could not confirm the key (status ${response.status}).`);
    }
  }

  /** The student must be able to see the course in their own course list. */
  private async assertCourseAccess(tenantId: string, courseId: string, actor: JwtUser) {
    const list = await this.lms.listMyCourses(tenantId, actor, { page: 1, pageSize: 100 });
    const items = (list as { items: Array<{ id: string }> }).items;
    if (!items.some(c => c.id === courseId)) {
      throw new AppError(403, 'COURSE_FORBIDDEN', 'You are not enrolled in this course');
    }
  }

  private async buildCourseContext(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        title: true,
        description: true,
        subject: { select: { name: true } },
        classRoom: { select: { name: true } },
        lessons: {
          where: { isPublished: true },
          orderBy: { sequence: 'asc' },
          select: { title: true, summary: true, body: true },
        },
      },
    });
    if (!course) return null;

    let text = `Course: ${course.title}\n`;
    if (course.subject?.name) text += `Subject: ${course.subject.name}\n`;
    if (course.classRoom?.name) text += `Class: ${course.classRoom.name}\n`;
    if (course.description) text += `Description: ${stripHtml(course.description)}\n`;
    text += '\nLessons:\n';
    course.lessons.forEach((lesson, index) => {
      text += `\n${index + 1}. ${lesson.title}\n`;
      if (lesson.summary) text += `Summary: ${stripHtml(lesson.summary)}\n`;
      if (lesson.body) text += `${stripHtml(lesson.body)}\n`;
    });
    if (!course.lessons.length) text += '(No published lessons yet.)\n';

    return {
      title: course.title,
      text:
        text.length > MAX_COURSE_CONTEXT_CHARS
          ? `${text.slice(0, MAX_COURSE_CONTEXT_CHARS)}\n…(course material shortened)`
          : text,
    };
  }

  async listConversations(tenantId: string, actor: JwtUser) {
    const conversations = await prisma.aiConversation.findMany({
      where: { tenantId, userId: actor.sub },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, courseId: true, createdAt: true, updatedAt: true },
    });
    return conversations;
  }

  async createConversation(tenantId: string, input: CreateConversationInput, actor: JwtUser) {
    let title = input.title ?? 'New conversation';
    if (input.courseId) {
      await this.assertCourseAccess(tenantId, input.courseId, actor);
      const course = await prisma.course.findUnique({ where: { id: input.courseId }, select: { title: true } });
      if (!input.title && course) title = course.title;
    }
    return prisma.aiConversation.create({
      data: { tenantId, userId: actor.sub, courseId: input.courseId, title },
      select: { id: true, title: true, courseId: true, createdAt: true, updatedAt: true },
    });
  }

  private async loadOwnConversation(tenantId: string, id: string, actor: JwtUser) {
    const conversation = await prisma.aiConversation.findFirst({
      where: { id, tenantId, userId: actor.sub },
    });
    if (!conversation) throw new AppError(404, 'AI_CONVERSATION_NOT_FOUND', 'Conversation not found');
    return conversation;
  }

  async getConversation(tenantId: string, id: string, actor: JwtUser) {
    const conversation = await this.loadOwnConversation(tenantId, id, actor);
    const messages = await prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return {
      id: conversation.id,
      title: conversation.title,
      courseId: conversation.courseId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages,
    };
  }

  async deleteConversation(tenantId: string, id: string, actor: JwtUser) {
    await this.loadOwnConversation(tenantId, id, actor);
    await prisma.aiConversation.delete({ where: { id } });
    return { deleted: true };
  }

  async sendMessage(tenantId: string, id: string, input: SendAiMessageInput, actor: JwtUser) {
    const config = await this.resolveConfig(tenantId);
    if (!config.enabled || !config.apiKey) {
      throw new AppError(503, 'AI_NOT_CONFIGURED', 'The AI assistant is not switched on for your school yet. Ask your school administrator.');
    }
    const conversation = await this.loadOwnConversation(tenantId, id, actor);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const usedToday = await prisma.aiMessage.count({
      where: {
        tenantId,
        role: AiMessageRole.USER,
        createdAt: { gte: startOfDay },
        conversation: { userId: actor.sub },
      },
    });
    if (usedToday >= config.dailyLimit) {
      throw new AppError(429, 'AI_DAILY_LIMIT', `You have reached today's limit of ${config.dailyLimit} questions. Try again tomorrow.`);
    }

    // Quick actions only make sense with a course attached.
    if (input.mode !== 'ask' && !conversation.courseId) {
      throw new AppError(400, 'AI_COURSE_REQUIRED', 'Pick a course first to summarize it, get examples or a quiz.');
    }

    const userText =
      input.mode === 'ask'
        ? input.content
        : `${MODE_PROMPTS[input.mode]}${input.content ? `\n\n${input.content}` : ''}`;

    const course = conversation.courseId ? await this.buildCourseContext(conversation.courseId) : null;
    const history = await prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true },
    });

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: course
          ? `${SYSTEM_PROMPT}\n\nThe student is studying this course. Course material:\n"""\n${course.text}\n"""`
          : SYSTEM_PROMPT,
      },
      ...history.reverse().map(m => ({
        role: m.role === AiMessageRole.USER ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
      { role: 'user', content: userText },
    ];

    const reply = await this.callOpenAi(messages, config);

    const isFirstMessage = history.length === 0;
    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.aiMessage.create({
        data: { tenantId, conversationId: id, role: AiMessageRole.USER, content: userText },
        select: { id: true, role: true, content: true, createdAt: true },
      }),
      prisma.aiMessage.create({
        data: { tenantId, conversationId: id, role: AiMessageRole.ASSISTANT, content: reply },
        select: { id: true, role: true, content: true, createdAt: true },
      }),
      prisma.aiConversation.update({
        where: { id },
        data: {
          // Name a free-form chat after its first question, like other chat apps do.
          ...(isFirstMessage && !conversation.courseId && input.mode === 'ask'
            ? { title: input.content.slice(0, 60) }
            : {}),
          updatedAt: new Date(),
        },
      }),
    ]);

    return {
      userMessage,
      assistantMessage,
      remainingToday: Math.max(config.dailyLimit - usedToday - 1, 0),
    };
  }

  private async callOpenAi(messages: ChatMessage[], config: AiConfig): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.4,
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      log.error({ err }, 'OpenAI request failed');
      throw new AppError(502, 'AI_UNAVAILABLE', 'The AI assistant is not reachable right now. Please try again.');
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.error({ status: response.status, body: body.slice(0, 500) }, 'OpenAI returned an error');
      if (response.status === 429) {
        throw new AppError(503, 'AI_BUSY', 'The AI assistant is busy right now. Please try again in a minute.');
      }
      if (response.status === 401) {
        throw new AppError(503, 'AI_NOT_CONFIGURED', 'Your school\'s OpenAI key is no longer valid. Ask your school administrator to update it.');
      }
      throw new AppError(502, 'AI_UNAVAILABLE', 'The AI assistant could not answer. Please try again.');
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new AppError(502, 'AI_UNAVAILABLE', 'The AI assistant returned an empty answer. Please try again.');
    }
    return content;
  }
}
