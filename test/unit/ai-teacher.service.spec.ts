jest.mock('../../src/db/prisma', () => {
  const prisma = {
    assessment: { findFirst: jest.fn() },
    lesson: { findMany: jest.fn() },
    course: { findFirst: jest.fn(), findMany: jest.fn() },
    classRoom: { findFirst: jest.fn() },
    subject: { findFirst: jest.fn() },
    aiMessage: { count: jest.fn(), createMany: jest.fn() },
    aiConversation: { findFirst: jest.fn(), create: jest.fn() },
  };
  return { prisma };
});

const resolveConfig = jest.fn();
const callOpenAi = jest.fn();
jest.mock('../../src/modules/ai-assistant/ai-assistant.service', () => ({
  AiAssistantService: jest.fn().mockImplementation(() => ({ resolveConfig, callOpenAi })),
  stripHtml: (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
}));

import { prisma } from '../../src/db/prisma';
import { JwtUser } from '../../src/common/types/auth.types';
import { AiTeacherService } from '../../src/modules/ai-assistant/ai-teacher.service';

const db = prisma as unknown as {
  assessment: { findFirst: jest.Mock };
  lesson: { findMany: jest.Mock };
  course: { findFirst: jest.Mock; findMany: jest.Mock };
  classRoom: { findFirst: jest.Mock };
  subject: { findFirst: jest.Mock };
  aiMessage: { count: jest.Mock; createMany: jest.Mock };
  aiConversation: { findFirst: jest.Mock; create: jest.Mock };
};

function actor(overrides: Partial<JwtUser> = {}): JwtUser {
  return { sub: 'teacher-1', tenantId: 'tenant-1', email: 't@example.com', roles: ['TEACHER'], permissions: [], ...overrides } as JwtUser;
}

const enabledConfig = { apiKey: 'sk-test', model: 'gpt-4o-mini', enabled: true, dailyLimit: 50, source: 'school' };

const assessment = {
  id: 'assessment-1',
  title: 'Fractions quiz',
  lessonId: null,
  course: { id: 'course-1', title: 'Maths P4', teacherUserId: 'teacher-1', subject: { name: 'Maths' }, classRoom: { name: 'P4 A' } },
  questions: [],
};

const questionsInput = {
  assessmentId: '44444444-4444-4444-8444-444444444444',
  lessonIds: [],
  count: 5,
  types: ['MCQ_SINGLE', 'OPEN_TEXT'] as Array<'MCQ_SINGLE' | 'OPEN_TEXT'>,
  difficulty: 'mixed' as const,
  language: 'en' as const,
};

describe('AiTeacherService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveConfig.mockResolvedValue(enabledConfig);
    db.aiMessage.count.mockResolvedValue(0);
    db.aiConversation.findFirst.mockResolvedValue({ id: 'conv-1' });
    db.aiMessage.createMany.mockResolvedValue({ count: 2 });
    db.lesson.findMany.mockResolvedValue([{ title: 'Adding fractions', summary: 'Same denominator', body: '<p>1/4 + 2/4 = 3/4</p>' }]);
  });

  it('refuses when the school has not switched AI on', async () => {
    db.assessment.findFirst.mockResolvedValue(assessment);
    resolveConfig.mockResolvedValue({ ...enabledConfig, enabled: false, apiKey: null });
    await expect(new AiTeacherService().generateAssessmentQuestions('tenant-1', questionsInput, actor())).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    expect(callOpenAi).not.toHaveBeenCalled();
  });

  it("blocks a teacher from generating questions for another teacher's test", async () => {
    db.assessment.findFirst.mockResolvedValue({ ...assessment, course: { ...assessment.course, teacherUserId: 'teacher-2' } });
    await expect(new AiTeacherService().generateAssessmentQuestions('tenant-1', questionsInput, actor())).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(callOpenAi).not.toHaveBeenCalled();
  });

  it('stops at the daily limit', async () => {
    db.assessment.findFirst.mockResolvedValue(assessment);
    db.aiMessage.count.mockResolvedValue(50);
    await expect(new AiTeacherService().generateAssessmentQuestions('tenant-1', questionsInput, actor())).rejects.toMatchObject({
      code: 'AI_DAILY_LIMIT',
    });
  });

  it('drops malformed questions and keeps the valid ones as an editable draft', async () => {
    db.assessment.findFirst.mockResolvedValue(assessment);
    callOpenAi.mockResolvedValue(
      JSON.stringify({
        questions: [
          { type: 'MCQ_SINGLE', prompt: 'What is 1/4 + 2/4?', points: 2, options: [
            { label: '3/4', isCorrect: true }, { label: '3/8', isCorrect: false }, { label: '1/2', isCorrect: false },
          ] },
          // two correct answers: dropped
          { type: 'MCQ_SINGLE', prompt: 'Bad one', options: [{ label: 'a', isCorrect: true }, { label: 'b', isCorrect: true }] },
          // type the web app cannot show: dropped
          { type: 'ESSAY', prompt: 'Write an essay', options: [] },
          { type: 'open_text', prompt: 'Explain why 2/4 equals 1/2.', points: 999, explanation: 'Divide top and bottom by 2', options: [{ label: 'x', isCorrect: true }] },
        ],
      })
    );

    const result = await new AiTeacherService().generateAssessmentQuestions('tenant-1', questionsInput, actor());

    expect(result.questions).toEqual([
      { type: 'MCQ_SINGLE', prompt: 'What is 1/4 + 2/4?', points: 2, explanation: undefined, options: [
        { label: '3/4', isCorrect: true }, { label: '3/8', isCorrect: false }, { label: '1/2', isCorrect: false },
      ] },
      { type: 'OPEN_TEXT', prompt: 'Explain why 2/4 equals 1/2.', points: 100, explanation: 'Divide top and bottom by 2', options: [] },
    ]);
    expect(result.basedOnLessons).toEqual(['Adding fractions']);
    // The lesson text is sent to the model.
    expect(callOpenAi.mock.calls[0][0][1].content).toContain('1/4 + 2/4 = 3/4');
    expect(callOpenAi.mock.calls[0][2]).toMatchObject({ json: true });
    // Usage is recorded so it counts toward the daily limit.
    expect(db.aiMessage.createMany).toHaveBeenCalled();
  });

  it('rejects lessons that are not part of the test course', async () => {
    db.assessment.findFirst.mockResolvedValue(assessment);
    db.lesson.findMany.mockResolvedValue([]);
    await expect(
      new AiTeacherService().generateAssessmentQuestions(
        'tenant-1',
        { ...questionsInput, lessonIds: ['55555555-5555-4555-8555-555555555555'] },
        actor()
      )
    ).rejects.toMatchObject({ code: 'LESSON_NOT_IN_COURSE' });
  });

  it('only drafts lesson plans for a class and subject the teacher teaches', async () => {
    db.course.findFirst.mockResolvedValue(null);
    await expect(
      new AiTeacherService().draftLessonPlan(
        'tenant-1',
        {
          academicYearId: '11111111-1111-4111-8111-111111111111',
          classRoomId: '22222222-2222-4222-8222-222222222222',
          subjectId: '33333333-3333-4333-8333-333333333333',
          topic: 'Fractions',
          language: 'en',
        },
        actor()
      )
    ).rejects.toMatchObject({ code: 'LESSON_PLAN_NOT_ASSIGNED' });
    expect(callOpenAi).not.toHaveBeenCalled();
  });

  it('turns the AI reply into lesson plan fields', async () => {
    db.course.findFirst.mockResolvedValue({ id: 'course-1' });
    db.classRoom.findFirst.mockResolvedValue({ name: 'P4 A', gradeLevel: { name: 'Primary 4' } });
    db.subject.findFirst.mockResolvedValue({ name: 'Maths' });
    db.course.findMany.mockResolvedValue([{ id: 'course-1' }]);
    callOpenAi.mockResolvedValue(
      '```json\n' +
        JSON.stringify({
          title: 'Adding fractions',
          objectives: ['Add fractions with the same denominator', 'Explain the rule'],
          materials: 'Paper strips',
          activities: 'Intro 5 min\nGroup work 25 min',
          assessment: 'Exit ticket',
        }) +
        '\n```'
    );

    const draft = await new AiTeacherService().draftLessonPlan(
      'tenant-1',
      {
        academicYearId: '11111111-1111-4111-8111-111111111111',
        classRoomId: '22222222-2222-4222-8222-222222222222',
        subjectId: '33333333-3333-4333-8333-333333333333',
        topic: 'Fractions',
        language: 'en',
      },
      actor()
    );

    expect(draft).toEqual({
      title: 'Adding fractions',
      objectives: '- Add fractions with the same denominator\n- Explain the rule',
      materials: 'Paper strips',
      activities: 'Intro 5 min\nGroup work 25 min',
      assessment: 'Exit ticket',
    });
  });
});
