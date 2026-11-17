import { AiMessageRole } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { rootLogger } from '../../config/logger';
import { prisma } from '../../db/prisma';
import { teacherTeachesClassSubject } from '../lesson-plans/lesson-plans.service';
import { AiAssistantService, AiConfig, stripHtml } from './ai-assistant.service';
import {
  AI_QUESTION_TYPES,
  AssessmentPrepInput,
  DraftLessonPlanInput,
  GenerateAssessmentQuestionsInput,
  GenerateStudyMaterialInput,
  STUDY_MATERIAL_FORMATS,
} from './ai-teacher.schemas';

const log = rootLogger.child({ module: 'ai-teacher' });

/** Lesson text sent to the model (keeps cost and latency predictable). */
const MAX_LESSON_CONTEXT_CHARS = 14_000;
/** Teacher tool requests are logged in one conversation per teacher, so they share the daily limit. */
const TEACHER_TOOLS_CONVERSATION_TITLE = 'Teacher planning tools';

const LANGUAGE_NAMES = { en: 'English', fr: 'French', rw: 'Kinyarwanda' } as const;

/** Course text sent for study material / assessment prep (a whole course can be long). */
const MAX_KNOWLEDGE_CONTEXT_CHARS = 24_000;

const STUDY_FORMAT_PROMPTS: Record<(typeof STUDY_MATERIAL_FORMATS)[number], { label: string; prompt: string }> = {
  summary: {
    label: 'Summary',
    prompt:
      'Write a clear summary for learners: a short overview paragraph, then one "##" section per lesson with the key ideas as bullet points, and finish with "## Key takeaways" (3-5 bullets).',
  },
  'revision-notes': {
    label: 'Revision notes',
    prompt:
      'Write concise revision notes learners can study before a test: headings per topic, bullet points, important definitions in bold, formulas or rules on their own line, and a short "Common mistakes" list at the end.',
  },
  'key-terms': {
    label: 'Key terms',
    prompt:
      'Write a glossary of the key terms and concepts: a Markdown table with columns Term | Meaning | Example, grouped by lesson with "##" headings. Use simple language for the class level.',
  },
  'study-guide': {
    label: 'Study guide',
    prompt:
      'Write a study guide: "## What you will learn" (objectives), "## Key ideas" per lesson, "## Worked examples" (2-3 step-by-step), "## Practice questions" (5 questions) and "## Answers" at the end.',
  },
};

const STUDY_SYSTEM_PROMPT = `You are an experienced teacher and curriculum specialist in Rwanda (Competence-Based Curriculum) helping a teacher on the Smart School platform turn their course content into study material for learners.
- Base the material strictly on the course content provided. If something important is missing, you may add standard curriculum knowledge for the subject and class, but keep it brief.
- Be accurate, well structured and age-appropriate for the class level. Use everyday examples from life in Rwanda when helpful.
- Format the answer in Markdown. Use plain notation for maths (e.g. x^2, 3/4), no LaTeX.
- Never include personal information. Decline anything unsafe or unsuitable for a school.`;

const TEACHER_SYSTEM_PROMPT = `You are an experienced curriculum and assessment specialist helping teachers in Rwanda (primary and secondary, Competence-Based Curriculum) using the Smart School platform.
- Be practical, specific and age-appropriate for the class level given.
- Prefer learner-centred activities, local examples from everyday life in Rwanda, and low-cost materials.
- Base content on the lesson material provided; do not invent facts beyond the subject curriculum.
- Never include personal information. Decline anything unsafe or unsuitable for a school.
- Reply ONLY with one JSON object in exactly the shape requested, no Markdown fences.`;

export interface GeneratedQuestion {
  type: (typeof AI_QUESTION_TYPES)[number];
  prompt: string;
  points: number;
  explanation?: string;
  options: Array<{ label: string; isCorrect: boolean }>;
}

function isAdmin(actor: JwtUser) {
  return actor.roles.includes('SCHOOL_ADMIN') || actor.roles.includes('SUPER_ADMIN');
}

function asText(value: unknown, max: number) {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .map(item => (item.startsWith('-') ? item : `- ${item}`))
      .join('\n')
      .slice(0, max);
  }
  return '';
}

function parseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new AppError(502, 'AI_BAD_RESPONSE', 'The AI returned an answer we could not read. Please try again.');
}

export class AiTeacherService {
  private readonly ai = new AiAssistantService();

  async getStatus(tenantId: string, actor?: JwtUser) {
    const config = await this.ai.resolveConfig(tenantId);
    const usedToday = actor ? await this.countUsedToday(tenantId, actor) : 0;
    return {
      enabled: config.enabled,
      model: config.model,
      dailyLimit: config.teacherDailyLimit,
      remainingToday: Math.max(config.teacherDailyLimit - usedToday, 0),
    };
  }

  // ---- Lesson plan draft ------------------------------------------------------

  async draftLessonPlan(tenantId: string, input: DraftLessonPlanInput, actor: JwtUser) {
    if (!actor.roles.includes('TEACHER')) {
      throw new AppError(403, 'FORBIDDEN', 'Only teachers can draft lesson plans');
    }
    const teaches = await teacherTeachesClassSubject(
      tenantId,
      actor.sub,
      input.academicYearId,
      input.classRoomId,
      input.subjectId
    );
    if (!teaches) {
      throw new AppError(403, 'LESSON_PLAN_NOT_ASSIGNED', 'You can only plan for a class and subject you teach.');
    }

    const config = await this.prepare(tenantId, actor);

    const [classRoom, subject, courses] = await Promise.all([
      prisma.classRoom.findFirst({
        where: { id: input.classRoomId, tenantId },
        select: { name: true, gradeLevel: { select: { name: true } } },
      }),
      prisma.subject.findFirst({ where: { id: input.subjectId, tenantId }, select: { name: true } }),
      prisma.course.findMany({
        where: {
          tenantId,
          teacherUserId: actor.sub,
          academicYearId: input.academicYearId,
          classRoomId: input.classRoomId,
          subjectId: input.subjectId,
          isActive: true,
        },
        select: { id: true },
      }),
    ]);

    // Existing lessons for this class + subject help the AI stay in line with what is taught.
    const lessons = await prisma.lesson.findMany({
      where: { tenantId, courseId: { in: courses.map(c => c.id) } },
      orderBy: { sequence: 'asc' },
      select: { title: true, summary: true },
      take: 40,
    });
    const lessonOutline = lessons
      .map((l, i) => `${i + 1}. ${l.title}${l.summary ? ` — ${stripHtml(l.summary).slice(0, 200)}` : ''}`)
      .join('\n');

    const userPrompt = `Draft a lesson plan.
Class: ${classRoom?.name ?? 'unknown'}${classRoom?.gradeLevel?.name ? ` (${classRoom.gradeLevel.name})` : ''}
Subject: ${subject?.name ?? 'unknown'}
Topic: ${input.topic}
${input.weekNumber ? `Week: ${input.weekNumber}\n` : ''}Lesson duration: ${input.durationMinutes ?? 40} minutes
${input.notes ? `Teacher notes: ${input.notes}\n` : ''}${lessonOutline ? `\nLessons already in this course (for context):\n${lessonOutline}\n` : ''}
Write everything in ${LANGUAGE_NAMES[input.language]}.
Return JSON with exactly these keys (all strings, use "\\n- " bullet lines inside strings where useful):
{
  "title": "short lesson title (max 120 chars)",
  "objectives": "3-5 measurable learning objectives (by the end of the lesson learners will be able to ...)",
  "materials": "teaching and learning materials, low-cost and locally available where possible",
  "activities": "step-by-step activities with timings that add up to the duration: introduction, development (learner activities), conclusion",
  "assessment": "how the teacher checks learning: questions, tasks, success criteria"
}`;

    const raw = await this.ai.callOpenAi(
      [
        { role: 'system', content: TEACHER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      config,
      { json: true, maxTokens: 2000, temperature: 0.5 }
    );
    const data = parseJson(raw);
    const draft = {
      title: asText(data.title, 200) || input.topic.slice(0, 200),
      objectives: asText(data.objectives, 5000),
      materials: asText(data.materials, 5000),
      activities: asText(data.activities, 10000),
      assessment: asText(data.assessment, 5000),
    };

    await this.logUsage(tenantId, actor, `Lesson plan draft: ${input.topic}`, draft.title);
    return draft;
  }

  // ---- Test questions -----------------------------------------------------------

  async generateAssessmentQuestions(tenantId: string, input: GenerateAssessmentQuestionsInput, actor: JwtUser) {
    const assessment = await prisma.assessment.findFirst({
      where: { id: input.assessmentId, tenantId },
      select: {
        id: true,
        title: true,
        lessonId: true,
        course: {
          select: {
            id: true,
            title: true,
            teacherUserId: true,
            subject: { select: { name: true } },
            classRoom: { select: { name: true } },
          },
        },
        questions: { select: { prompt: true }, take: 100 },
      },
    });
    if (!assessment) throw new AppError(404, 'ASSESSMENT_NOT_FOUND', 'Assessment not found');
    if (!isAdmin(actor) && !(actor.roles.includes('TEACHER') && actor.sub === assessment.course.teacherUserId)) {
      throw new AppError(403, 'COURSE_MANAGE_FORBIDDEN', 'You cannot manage this course');
    }

    const config = await this.prepare(tenantId, actor);

    // Which lessons: the ones picked, else the test's own lesson, else the whole course.
    const lessonIds = input.lessonIds.length ? input.lessonIds : assessment.lessonId ? [assessment.lessonId] : [];
    const lessons = await prisma.lesson.findMany({
      where: {
        tenantId,
        courseId: assessment.course.id,
        ...(lessonIds.length ? { id: { in: lessonIds } } : {}),
      },
      orderBy: { sequence: 'asc' },
      select: { title: true, summary: true, body: true },
    });
    if (lessonIds.length && lessons.length !== lessonIds.length) {
      throw new AppError(400, 'LESSON_NOT_IN_COURSE', 'Some selected lessons are not part of this course');
    }

    let material = '';
    lessons.forEach((lesson, i) => {
      material += `\n${i + 1}. ${lesson.title}\n`;
      if (lesson.summary) material += `Summary: ${stripHtml(lesson.summary)}\n`;
      if (lesson.body) material += `${stripHtml(lesson.body)}\n`;
    });
    const hasMaterial = material.trim().length > 0 && lessons.some(l => l.summary || l.body);
    if (material.length > MAX_LESSON_CONTEXT_CHARS) {
      material = `${material.slice(0, MAX_LESSON_CONTEXT_CHARS)}\n…(lesson material shortened)`;
    }

    const existing = assessment.questions
      .map(q => stripHtml(q.prompt).slice(0, 140))
      .filter(Boolean)
      .slice(0, 40);

    const typeHelp: Record<(typeof AI_QUESTION_TYPES)[number], string> = {
      MCQ_SINGLE: 'MCQ_SINGLE = multiple choice with 4 options and exactly one correct',
      OPEN_TEXT: 'OPEN_TEXT = written answer, from one sentence to a short paragraph (no options)',
    };

    const userPrompt = `Write ${input.count} test questions for the assessment "${assessment.title}".
Course: ${assessment.course.title}
${assessment.course.subject?.name ? `Subject: ${assessment.course.subject.name}\n` : ''}${assessment.course.classRoom?.name ? `Class: ${assessment.course.classRoom.name}\n` : ''}Difficulty: ${input.difficulty}
Question types to use (spread them across the questions): ${input.types.map(t => typeHelp[t]).join('; ')}
${input.instructions ? `Teacher instructions: ${input.instructions}\n` : ''}${existing.length ? `\nThe test already has these questions; do not repeat them:\n- ${existing.join('\n- ')}\n` : ''}
${hasMaterial ? `Base every question on this lesson material:\n"""${material}\n"""` : `There is little lesson text, so base the questions on these lesson titles and the standard curriculum for this subject and class:\n${material || assessment.course.title}`}

Write everything in ${LANGUAGE_NAMES[input.language]}.
Return JSON: {"questions": [{"type": "MCQ_SINGLE|OPEN_TEXT", "prompt": "question text", "points": 1-10, "explanation": "model answer or why the correct option is right", "options": [{"label": "option text", "isCorrect": true|false}]}]}
Options only for MCQ_SINGLE (exactly 4, exactly one isCorrect true); use [] for other types.`;

    const raw = await this.ai.callOpenAi(
      [
        { role: 'system', content: TEACHER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      config,
      { json: true, maxTokens: Math.min(400 * input.count + 500, 8000), temperature: 0.5 }
    );
    const data = parseJson(raw);
    const questions = this.sanitizeQuestions(data.questions, input.types).slice(0, input.count);
    if (!questions.length) {
      throw new AppError(502, 'AI_BAD_RESPONSE', 'The AI did not return usable questions. Please try again.');
    }

    await this.logUsage(tenantId, actor, `Test questions: ${assessment.title}`, `${questions.length} questions`);
    return { questions, basedOnLessons: lessons.map(l => l.title) };
  }

  /** Keep only questions that the assessments API would accept. */
  private sanitizeQuestions(value: unknown, allowed: readonly string[]): GeneratedQuestion[] {
    if (!Array.isArray(value)) return [];
    const result: GeneratedQuestion[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const q = item as Record<string, unknown>;
      const type = String(q.type ?? '').toUpperCase() as GeneratedQuestion['type'];
      if (!AI_QUESTION_TYPES.includes(type) || !allowed.includes(type)) continue;
      const prompt = asText(q.prompt, 2000);
      if (prompt.length < 2) continue;
      const pointsRaw = Number(q.points);
      const points = Number.isFinite(pointsRaw) ? Math.min(Math.max(Math.round(pointsRaw), 1), 100) : 1;
      const explanation = asText(q.explanation, 2000) || undefined;

      let options: GeneratedQuestion['options'] = [];
      if (type === 'MCQ_SINGLE') {
        const rawOptions = Array.isArray(q.options) ? q.options : [];
        options = rawOptions
          .map(o => {
            const opt = (o ?? {}) as Record<string, unknown>;
            return { label: asText(opt.label, 500), isCorrect: opt.isCorrect === true };
          })
          .filter(o => o.label.length > 0)
          .slice(0, 6);
        if (options.length < 2 || options.filter(o => o.isCorrect).length !== 1) continue;
      }
      result.push({ type, prompt, points, explanation, options });
    }
    return result;
  }

  // ---- Knowledge base (the teacher's own course content) ----------------------

  /** Courses the teacher can use as sources, with their lessons grouped by section. */
  async getKnowledgeBase(tenantId: string, actor: JwtUser) {
    const courses = await prisma.course.findMany({
      where: { tenantId, isActive: true, ...(isAdmin(actor) ? {} : { teacherUserId: actor.sub }) },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        title: true,
        subject: { select: { name: true } },
        classRoom: { select: { name: true } },
        academicYear: { select: { name: true } },
        sections: { orderBy: { sortOrder: 'asc' }, select: { id: true, title: true } },
        lessons: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            title: true,
            contentType: true,
            sectionId: true,
            isPublished: true,
            summary: true,
            body: true,
          },
        },
      },
    });
    return courses.map(course => ({
      id: course.id,
      title: course.title,
      subjectName: course.subject?.name ?? null,
      classRoomName: course.classRoom?.name ?? null,
      academicYearName: course.academicYear?.name ?? null,
      sections: course.sections,
      lessons: course.lessons.map(l => ({
        id: l.id,
        title: l.title,
        contentType: l.contentType,
        sectionId: l.sectionId,
        isPublished: l.isPublished,
        // Only written text can be read by the AI; PDFs/videos/links contribute their title and summary.
        hasText: Boolean((l.body && stripHtml(l.body)) || (l.summary && stripHtml(l.summary))),
      })),
    }));
  }

  /** Loads a course the actor may use, plus the chosen lessons' text, ready for a prompt. */
  private async loadCourseMaterial(tenantId: string, courseId: string, lessonIds: string[], actor: JwtUser) {
    const course = await prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: {
        id: true,
        title: true,
        description: true,
        teacherUserId: true,
        subject: { select: { name: true } },
        classRoom: { select: { name: true, gradeLevel: { select: { name: true } } } },
      },
    });
    if (!course) throw new AppError(404, 'COURSE_NOT_FOUND', 'Course not found');
    if (!isAdmin(actor) && !(actor.roles.includes('TEACHER') && actor.sub === course.teacherUserId)) {
      throw new AppError(403, 'COURSE_MANAGE_FORBIDDEN', 'You can only use your own courses');
    }

    const lessons = await prisma.lesson.findMany({
      where: { tenantId, courseId, ...(lessonIds.length ? { id: { in: lessonIds } } : {}) },
      orderBy: { sequence: 'asc' },
      select: { title: true, summary: true, body: true, contentType: true, section: { select: { title: true } } },
    });
    if (lessonIds.length && lessons.length !== lessonIds.length) {
      throw new AppError(400, 'LESSON_NOT_IN_COURSE', 'Some selected lessons are not part of this course');
    }
    if (!lessons.length) {
      throw new AppError(400, 'AI_NO_CONTENT', 'This course has no lessons yet. Add lessons first, then try again.');
    }

    let material = '';
    let currentSection: string | null = null;
    lessons.forEach((lesson, i) => {
      const section = lesson.section?.title ?? null;
      if (section && section !== currentSection) material += `\n## Unit: ${section}\n`;
      currentSection = section;
      material += `\n${i + 1}. ${lesson.title}${lesson.contentType !== 'TEXT' ? ` (${lesson.contentType} lesson)` : ''}\n`;
      if (lesson.summary) material += `Summary: ${stripHtml(lesson.summary)}\n`;
      if (lesson.body) material += `${stripHtml(lesson.body)}\n`;
    });
    const hasText = lessons.some(l => (l.body && stripHtml(l.body)) || (l.summary && stripHtml(l.summary)));
    const truncated = material.length > MAX_KNOWLEDGE_CONTEXT_CHARS;
    if (truncated) material = `${material.slice(0, MAX_KNOWLEDGE_CONTEXT_CHARS)}\n…(course content shortened)`;

    const classLabel = course.classRoom
      ? `${course.classRoom.name}${course.classRoom.gradeLevel?.name ? ` (${course.classRoom.gradeLevel.name})` : ''}`
      : null;
    const header = `Course: ${course.title}\n${course.subject?.name ? `Subject: ${course.subject.name}\n` : ''}${classLabel ? `Class: ${classLabel}\n` : ''}${course.description ? `Course description: ${stripHtml(course.description).slice(0, 500)}\n` : ''}`;

    return { course, lessons, material, hasText, truncated, header };
  }

  // ---- Study material ------------------------------------------------------------

  async generateStudyMaterial(tenantId: string, input: GenerateStudyMaterialInput, actor: JwtUser) {
    const { course, lessons, material, hasText, truncated, header } = await this.loadCourseMaterial(
      tenantId,
      input.courseId,
      input.lessonIds,
      actor
    );
    const config = await this.prepare(tenantId, actor);
    const format = STUDY_FORMAT_PROMPTS[input.format];

    const userPrompt = `${format.prompt}
${input.instructions ? `\nTeacher instructions: ${input.instructions}\n` : ''}
${header}
${hasText ? 'Course content (the knowledge base):' : 'The lessons have little written text, so use these lesson titles and the standard curriculum for this subject and class:'}
"""${material}
"""

Write everything in ${LANGUAGE_NAMES[input.language]}. Start with a "#" title.`;

    const content = await this.ai.callOpenAi(
      [
        { role: 'system', content: STUDY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      config,
      { maxTokens: 3000, temperature: 0.4 }
    );

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = (titleMatch?.[1] ?? `${format.label}: ${course.title}`).trim().slice(0, 200);
    await this.logUsage(tenantId, actor, `Study material (${format.label}): ${course.title}`, title);
    return {
      title,
      format: input.format,
      content,
      basedOnLessons: lessons.map(l => l.title),
      usedWrittenContent: hasText,
      contentShortened: truncated,
    };
  }

  // ---- Assessment preparation -----------------------------------------------------

  async prepareAssessment(tenantId: string, input: AssessmentPrepInput, actor: JwtUser) {
    const { course, lessons, material, hasText, truncated, header } = await this.loadCourseMaterial(
      tenantId,
      input.courseId,
      input.lessonIds,
      actor
    );
    const config = await this.prepare(tenantId, actor);

    const typeHelp: Record<(typeof AI_QUESTION_TYPES)[number], string> = {
      MCQ_SINGLE: 'MCQ_SINGLE = multiple choice with 4 options and exactly one correct',
      OPEN_TEXT: 'OPEN_TEXT = written answer, from one sentence to a short paragraph (no options)',
    };

    const userPrompt = `Prepare an assessment of ${input.count} questions from this course.
${header}Difficulty: ${input.difficulty}
Question types to use (spread them across the questions): ${input.types.map(t => typeHelp[t]).join('; ')}
Cover the lessons evenly and test understanding and application, not only recall.
${input.instructions ? `Teacher instructions: ${input.instructions}\n` : ''}
${hasText ? 'Base every question on this course content:' : 'There is little lesson text, so base the questions on these lesson titles and the standard curriculum for this subject and class:'}
"""${material}
"""

Write everything in ${LANGUAGE_NAMES[input.language]}.
Return JSON: {"title": "suggested assessment title", "instructions": "one or two sentences of instructions for learners", "questions": [{"type": "MCQ_SINGLE|OPEN_TEXT", "prompt": "question text", "points": 1-10, "explanation": "model answer / marking guide, or why the correct option is right", "options": [{"label": "option text", "isCorrect": true|false}]}]}
Options only for MCQ_SINGLE (exactly 4, exactly one isCorrect true); use [] for other types.`;

    const raw = await this.ai.callOpenAi(
      [
        { role: 'system', content: TEACHER_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      config,
      { json: true, maxTokens: Math.min(400 * input.count + 600, 8000), temperature: 0.5 }
    );
    const data = parseJson(raw);
    const questions = this.sanitizeQuestions(data.questions, input.types).slice(0, input.count);
    if (!questions.length) {
      throw new AppError(502, 'AI_BAD_RESPONSE', 'The AI did not return usable questions. Please try again.');
    }
    const title = asText(data.title, 200) || `${course.title} — assessment`;
    await this.logUsage(tenantId, actor, `Assessment prep: ${course.title}`, `${questions.length} questions`);
    return {
      title,
      instructions: asText(data.instructions, 2000),
      questions,
      totalPoints: questions.reduce((sum, q) => sum + q.points, 0),
      basedOnLessons: lessons.map(l => l.title),
      usedWrittenContent: hasText,
      contentShortened: truncated,
    };
  }

  // ---- Shared -----------------------------------------------------------------

  /** Checks the school has AI switched on and the teacher is within today's limit. */
  private async prepare(tenantId: string, actor: JwtUser): Promise<AiConfig> {
    const config = await this.ai.resolveConfig(tenantId);
    if (!config.enabled || !config.apiKey) {
      throw new AppError(
        503,
        'AI_NOT_CONFIGURED',
        'The AI assistant is not available right now. The platform administrator has not switched it on yet; please contact support.'
      );
    }
    const usedToday = await this.countUsedToday(tenantId, actor);
    if (usedToday >= config.teacherDailyLimit) {
      throw new AppError(429, 'AI_DAILY_LIMIT', `You have reached today's limit of ${config.teacherDailyLimit} AI requests. Try again tomorrow.`);
    }
    return config;
  }

  private countUsedToday(tenantId: string, actor: JwtUser) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return prisma.aiMessage.count({
      where: {
        tenantId,
        role: AiMessageRole.USER,
        createdAt: { gte: startOfDay },
        conversation: { userId: actor.sub },
      },
    });
  }

  /** Records the request so it counts toward the daily limit and leaves a trace. */
  private async logUsage(tenantId: string, actor: JwtUser, request: string, summary: string) {
    try {
      let conversation = await prisma.aiConversation.findFirst({
        where: { tenantId, userId: actor.sub, courseId: null, title: TEACHER_TOOLS_CONVERSATION_TITLE },
        select: { id: true },
      });
      if (!conversation) {
        conversation = await prisma.aiConversation.create({
          data: { tenantId, userId: actor.sub, title: TEACHER_TOOLS_CONVERSATION_TITLE },
          select: { id: true },
        });
      }
      await prisma.aiMessage.createMany({
        data: [
          { tenantId, conversationId: conversation.id, role: AiMessageRole.USER, content: request.slice(0, 500) },
          { tenantId, conversationId: conversation.id, role: AiMessageRole.ASSISTANT, content: summary.slice(0, 500) },
        ],
      });
    } catch (err) {
      // The teacher already has their draft; a logging failure must not lose it.
      log.error({ err, tenantId }, 'Could not record teacher AI usage');
    }
  }
}

