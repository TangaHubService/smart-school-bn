jest.mock('../../src/db/prisma', () => ({
  prisma: { aiKnowledgeDocument: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() } },
}));

import { prisma } from '../../src/db/prisma';
import { JwtUser } from '../../src/common/types/auth.types';
import { AiKnowledgeService } from '../../src/modules/ai-assistant/ai-knowledge.service';

const db = prisma as unknown as {
  aiKnowledgeDocument: { findMany: jest.Mock; count: jest.Mock; create: jest.Mock };
};
const actor = { sub: 'teacher-1', tenantId: 'tenant-1', roles: ['TEACHER'], permissions: [] } as unknown as JwtUser;

function book(topicAt: number, paragraphs = 200) {
  return Array.from({ length: paragraphs }, (_, i) =>
    i === topicAt
      ? 'Photosynthesis happens in the chloroplast: plants use sunlight, water and carbon dioxide to make glucose and oxygen.'
      : `Paragraph ${i} talks about general history of farming and trade routes across the region in some detail.`
  ).join('\n\n');
}

describe('AiKnowledgeService.buildExcerpt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns nothing when no documents are chosen', async () => {
    const result = await new AiKnowledgeService().buildExcerpt('tenant-1', actor, [], 'anything', 1000);
    expect(result).toEqual({ documents: [], text: '', selected: false });
    expect(db.aiKnowledgeDocument.findMany).not.toHaveBeenCalled();
  });

  it('sends a short document whole', async () => {
    db.aiKnowledgeDocument.findMany.mockResolvedValue([{ id: 'd1', title: 'Notes', textContent: 'Short notes.' }]);
    const result = await new AiKnowledgeService().buildExcerpt('tenant-1', actor, ['d1'], 'notes', 1000);
    expect(result.selected).toBe(false);
    expect(result.text).toContain('Short notes.');
  });

  it('picks the passage that matches the request from a long book', async () => {
    db.aiKnowledgeDocument.findMany.mockResolvedValue([{ id: 'd1', title: 'Biology book', textContent: book(150) }]);
    const result = await new AiKnowledgeService().buildExcerpt(
      'tenant-1',
      actor,
      ['d1'],
      'Summary notes on photosynthesis and chloroplast',
      4000
    );
    expect(result.selected).toBe(true);
    expect(result.text).toContain('Photosynthesis happens in the chloroplast');
    expect(result.text.length).toBeLessThan(4500);
  });

  it("refuses documents the teacher doesn't own", async () => {
    db.aiKnowledgeDocument.findMany.mockResolvedValue([]);
    await expect(
      new AiKnowledgeService().buildExcerpt('tenant-1', actor, ['someone-elses'], 'x', 1000)
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_DOCUMENT_NOT_FOUND' });
  });
});

describe('AiKnowledgeService.uploadDocument', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores the text of a plain-text file', async () => {
    db.aiKnowledgeDocument.count.mockResolvedValue(0);
    db.aiKnowledgeDocument.create.mockImplementation(({ data }) => Promise.resolve({ id: 'd1', ...data }));
    const text = 'Chapter 1. Fractions are parts of a whole. '.repeat(5);
    const created = await new AiKnowledgeService().uploadDocument('tenant-1', actor, {
      buffer: Buffer.from(text),
      fileName: 'maths-notes.txt',
      mimeType: 'text/plain',
    });
    expect(created).toMatchObject({ title: 'maths-notes' });
    expect(db.aiKnowledgeDocument.create.mock.calls[0][0].data.textContent).toContain('Fractions are parts');
  });

  it('rejects unsupported file types', async () => {
    await expect(
      new AiKnowledgeService().uploadDocument('tenant-1', actor, {
        buffer: Buffer.from('x'.repeat(100)),
        fileName: 'photo.png',
        mimeType: 'image/png',
      })
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_FILE_TYPE' });
  });
});
