import {
  FileAssetResourceType,
  LessonContentType,
  SubmissionStatus,
} from '@prisma/client';
import { z } from 'zod';

function htmlToPlainText(value: string | undefined) {
  return (value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const uploadedAssetSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
  secureUrl: z.string().trim().url(),
  originalName: z.string().trim().min(1).max(255),
  bytes: z.number().int().positive().max(1_000_000_000).optional(),
  format: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  resourceType: z.nativeEnum(FileAssetResourceType),
});

export const createCourseSchema = z
  .object({
    academicYearId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    subjectId: z.string().uuid().optional(),
    teacherUserId: z.string().uuid().optional(),
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const updateCourseSchema = z
  .object({
    academicYearId: z.string().uuid().optional(),
    classRoomId: z.string().uuid().optional(),
    subjectId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const assignCourseTeacherSchema = z
  .object({
    teacherUserId: z.string().uuid(),
  })
  .strict();

export const assignTeacherBySubjectSchema = z
  .object({
    teacherUserId: z.string().uuid(),
    academicYearId: z.string().uuid(),
    classRoomId: z.string().uuid(),
    subjectId: z.string().uuid(),
  })
  .strict();

export const listCoursesQuerySchema = z.object({
  classId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  teacherUserId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const courseDetailQuerySchema = z.object({
  lessonsPage: z.coerce.number().int().min(1).default(1),
  lessonsPageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const createLessonSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    summary: z.string().trim().max(500).optional(),
    contentType: z.nativeEnum(LessonContentType),
    body: z.string().max(40_000).optional(),
    externalUrl: z.string().trim().url().optional(),
    sequence: z.number().int().min(1).optional(),
    asset: uploadedAssetSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.contentType === LessonContentType.TEXT && !htmlToPlainText(value.body)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: 'Text lessons require body content',
      });
    }

    if (value.contentType === LessonContentType.PDF && !value.asset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['asset'],
        message: 'PDF lessons require an uploaded file',
      });
    }

    if (value.contentType === LessonContentType.LINK && !value.externalUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['externalUrl'],
        message: 'Link lessons require an external URL',
      });
    }

    if (
      value.contentType === LessonContentType.VIDEO &&
      !value.externalUrl &&
      !value.asset
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['externalUrl'],
        message: 'Video lessons require a video URL or uploaded video file',
      });
    }
  });

export const updateLessonSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    summary: z.string().trim().max(500).nullable().optional(),
    contentType: z.nativeEnum(LessonContentType).optional(),
    body: z.string().max(40_000).nullable().optional(),
    externalUrl: z.union([z.string().trim().url(), z.literal(''), z.null()]).optional(),
    sequence: z.number().int().min(1).optional(),
    asset: uploadedAssetSchema.optional(),
    removeAsset: z.boolean().optional(),
  })
  .strict();

/** Capped per request so clients cannot inflate time in one shot. */
export const recordLessonActivitySchema = z
  .object({
    secondsDelta: z.number().int().min(1).max(120),
  })
  .strict();

export const publishLessonSchema = z
  .object({
    isPublished: z.boolean(),
  })
  .strict();

export const createAssignmentSchema = z
  .object({
    courseId: z.string().uuid(),
    lessonId: z.string().uuid().optional(),
    title: z.string().trim().min(2).max(120),
    instructions: z
      .string()
      .max(40_000)
      .refine((value) => htmlToPlainText(value).length >= 2, 'Instructions are required'),
    dueAt: z.string().datetime().optional(),
    maxPoints: z.number().int().min(1).max(1000).default(100),
    isPublished: z.boolean().default(true),
    asset: uploadedAssetSchema.optional(),
  })
  .strict();

export const createSubmissionSchema = z
  .object({
    textAnswer: z.string().trim().max(10_000).optional(),
    linkUrl: z.string().trim().url().optional(),
    asset: uploadedAssetSchema.optional(),
  })
  .superRefine((value, context) => {
    if (!value.textAnswer?.trim() && !value.linkUrl && !value.asset) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['textAnswer'],
        message: 'Submit text, a link, or a file attachment',
      });
    }
  });

export const gradeSubmissionSchema = z
  .object({
    gradePoints: z.number().int().min(0).max(1000),
    feedback: z.string().trim().max(5000).optional(),
  })
  .strict();

export const listAssignmentSubmissionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  status: z.nativeEnum(SubmissionStatus).optional(),
});

export const listAssignmentsQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const listMyCoursesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listCourseTeacherOptionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
});

export const listCourseSubjectOptionsQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
});

export const createAcademyProgramSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    thumbnail: z.union([z.string().trim().url().max(2000), z.literal('')]).optional(),
    price: z.coerce.number().positive().max(1_000_000_000),
    durationDays: z.coerce.number().int().min(1).max(3650).default(30),
    isActive: z.boolean().optional().default(true),
    listedInPublicCatalog: z.boolean().optional().default(true),
    courseId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const updateAcademyProgramSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    thumbnail: z.union([z.string().trim().url().max(2000), z.literal('')]).nullable().optional(),
    price: z.coerce.number().positive().max(1_000_000_000).optional(),
    durationDays: z.coerce.number().int().min(1).max(3650).optional(),
    isActive: z.boolean().optional(),
    listedInPublicCatalog: z.boolean().optional(),
    courseId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type AssignCourseTeacherInput = z.infer<typeof assignCourseTeacherSchema>;
export type AssignTeacherBySubjectInput = z.infer<typeof assignTeacherBySubjectSchema>;
export type ListCoursesQueryInput = z.infer<typeof listCoursesQuerySchema>;
export type CourseDetailQueryInput = z.infer<typeof courseDetailQuerySchema>;
export type UploadedAssetInput = z.infer<typeof uploadedAssetSchema>;
export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export type PublishLessonInput = z.infer<typeof publishLessonSchema>;
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;
export type GradeSubmissionInput = z.infer<typeof gradeSubmissionSchema>;
export type ListAssignmentSubmissionsQueryInput = z.infer<
  typeof listAssignmentSubmissionsQuerySchema
>;
export type ListAssignmentsQueryInput = z.infer<typeof listAssignmentsQuerySchema>;
export type ListMyCoursesQueryInput = z.infer<typeof listMyCoursesQuerySchema>;
export type RecordLessonActivityInput = z.infer<typeof recordLessonActivitySchema>;
export type ListCourseTeacherOptionsQueryInput = z.infer<
  typeof listCourseTeacherOptionsQuerySchema
>;
export type ListCourseSubjectOptionsQueryInput = z.infer<
  typeof listCourseSubjectOptionsQuerySchema
>;
export type CreateAcademyProgramInput = z.infer<typeof createAcademyProgramSchema>;
export type UpdateAcademyProgramInput = z.infer<typeof updateAcademyProgramSchema>;
