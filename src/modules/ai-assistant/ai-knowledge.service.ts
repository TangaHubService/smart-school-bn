import mammoth from 'mammoth';
// The package root runs a debug script when imported directly; the lib entry does not.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';

/** Largest file a teacher can upload (a full textbook PDF fits comfortably). */
export const MAX_KNOWLEDGE_FILE_BYTES = 25 * 1024 * 1024;
/** Extracted text kept per document (~ a 600-page book). */
const MAX_DOCUMENT_CHARS = 1_500_000;
/** Documents a teacher can keep in their library. */
const MAX_DOCUMENTS_PER_TEACHER = 100;
/** Size of the passages documents are split into when choosing what the AI reads. */
const CHUNK_CHARS = 1_800;

const STOP_WORDS = new Set(
  (
    'the a an and or of to in on for with by is are was were be been it its this that these those as at from ' +
    'about into than then so such can will would should could may might must not no do does did have has had ' +
    'i you he she we they them their our your his her what which who whom when where why how all any each ' +
    'make write give create please also more most some only very use using based learners students student ' +
    'les des une un et ou de du la le en pour avec sur dans est sont na ya za kandi mu ku'
  ).split(/\s+/)
);

type SupportedKind = 'pdf' | 'docx' | 'text';

function detectKind(fileName: string, mimeType: string): SupportedKind | null {
  const name = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (mimeType.startsWith('text/') || /\.(txt|md|markdown|csv)$/.test(name)) return 'text';
  return null;
}

function normalizeText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP_WORDS.has(w));
}

/** Splits text into passages on paragraph boundaries, each about CHUNK_CHARS long. */
function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (para.length > CHUNK_CHARS) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < para.length; i += CHUNK_CHARS) chunks.push(para.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (current.length + para.length + 2 > CHUNK_CHARS && current) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface KnowledgeExcerpt {
  documents: Array<{ id: string; title: string }>;
  /** Text block ready to place in a prompt (empty when no documents were chosen). */
  text: string;
  /** True when only part of the documents fit and the most relevant passages were picked. */
  selected: boolean;
}

export class AiKnowledgeService {
  async listDocuments(tenantId: string, actor: JwtUser) {
    const docs = await prisma.aiKnowledgeDocument.findMany({
      where: { tenantId, ownerUserId: actor.sub },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        pageCount: true,
        charCount: true,
        createdAt: true,
      },
    });
    return docs;
  }

  async uploadDocument(
    tenantId: string,
    actor: JwtUser,
    file: { buffer: Buffer; fileName: string; mimeType: string; title?: string }
  ) {
    if (!file.buffer.length) {
      throw new AppError(400, 'KNOWLEDGE_FILE_EMPTY', 'The file is empty.');
    }
    if (file.buffer.length > MAX_KNOWLEDGE_FILE_BYTES) {
      throw new AppError(413, 'KNOWLEDGE_FILE_TOO_LARGE', 'The file is larger than 25 MB.');
    }
    const kind = detectKind(file.fileName, file.mimeType);
    if (!kind) {
      throw new AppError(
        415,
        'KNOWLEDGE_FILE_TYPE',
        'Only PDF, Word (.docx) and text (.txt, .md) files can be added to the knowledge base.'
      );
    }

    const count = await prisma.aiKnowledgeDocument.count({ where: { tenantId, ownerUserId: actor.sub } });
    if (count >= MAX_DOCUMENTS_PER_TEACHER) {
      throw new AppError(
        409,
        'KNOWLEDGE_LIBRARY_FULL',
        `You can keep up to ${MAX_DOCUMENTS_PER_TEACHER} documents. Remove some before adding more.`
      );
    }

    let text = '';
    let pageCount: number | null = null;
    try {
      if (kind === 'pdf') {
        const parsed = await pdfParse(file.buffer);
        text = parsed.text ?? '';
        pageCount = parsed.numpages ?? null;
      } else if (kind === 'docx') {
        const parsed = await mammoth.extractRawText({ buffer: file.buffer });
        text = parsed.value ?? '';
      } else {
        text = file.buffer.toString('utf8');
      }
    } catch {
      throw new AppError(
        422,
        'KNOWLEDGE_FILE_UNREADABLE',
        'We could not read this file. Check that it is not password-protected or damaged.'
      );
    }

    text = normalizeText(text);
    if (text.length < 50) {
      throw new AppError(
        422,
        'KNOWLEDGE_NO_TEXT',
        'No readable text was found in this file. Scanned books (photos of pages) cannot be read; use a PDF with selectable text.'
      );
    }
    if (text.length > MAX_DOCUMENT_CHARS) text = text.slice(0, MAX_DOCUMENT_CHARS);

    const baseName = file.fileName.replace(/\.[^.]+$/, '').trim();
    const title = (file.title?.trim() || baseName || 'Document').slice(0, 200);

    return prisma.aiKnowledgeDocument.create({
      data: {
        tenantId,
        ownerUserId: actor.sub,
        title,
        fileName: file.fileName.slice(0, 255),
        mimeType: file.mimeType.slice(0, 120),
        sizeBytes: file.buffer.length,
        pageCount,
        charCount: text.length,
        textContent: text,
      },
      select: {
        id: true,
        title: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        pageCount: true,
        charCount: true,
        createdAt: true,
      },
    });
  }

  async deleteDocument(tenantId: string, actor: JwtUser, id: string) {
    const deleted = await prisma.aiKnowledgeDocument.deleteMany({
      where: { id, tenantId, ownerUserId: actor.sub },
    });
    if (!deleted.count) throw new AppError(404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND', 'Document not found');
    return { deleted: true };
  }

  /**
   * Reads the chosen documents and returns the passages most relevant to `query`
   * (the teacher's request, topic and lesson titles), within `budgetChars`.
   * With no useful query, passages are spread evenly so the whole book is covered.
   */
  async buildExcerpt(
    tenantId: string,
    actor: JwtUser,
    documentIds: string[],
    query: string,
    budgetChars: number
  ): Promise<KnowledgeExcerpt> {
    if (!documentIds.length) return { documents: [], text: '', selected: false };

    const docs = await prisma.aiKnowledgeDocument.findMany({
      where: { tenantId, ownerUserId: actor.sub, id: { in: documentIds } },
      select: { id: true, title: true, textContent: true },
    });
    if (docs.length !== new Set(documentIds).size) {
      throw new AppError(404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND', 'Some selected documents were not found');
    }

    const total = docs.reduce((sum, d) => sum + d.textContent.length, 0);
    if (total <= budgetChars) {
      return {
        documents: docs.map(d => ({ id: d.id, title: d.title })),
        text: docs.map(d => `### Document: ${d.title}\n${d.textContent}`).join('\n\n'),
        selected: false,
      };
    }

    type Chunk = { docIndex: number; position: number; text: string; score: number };
    const chunks: Chunk[] = [];
    docs.forEach((doc, docIndex) => {
      chunkText(doc.textContent).forEach((text, position) =>
        chunks.push({ docIndex, position, text, score: 0 })
      );
    });

    const queryTerms = [...new Set(keywords(query))];
    if (queryTerms.length) {
      // Rarer words matter more (simple IDF), and passages are scored by term frequency.
      const docFreq = new Map<string, number>();
      const chunkTerms = chunks.map(c => {
        const counts = new Map<string, number>();
        for (const w of keywords(c.text)) counts.set(w, (counts.get(w) ?? 0) + 1);
        for (const w of counts.keys()) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
        return counts;
      });
      chunks.forEach((chunk, i) => {
        let score = 0;
        for (const term of queryTerms) {
          const tf = chunkTerms[i].get(term) ?? 0;
          if (!tf) continue;
          const idf = Math.log(1 + chunks.length / (docFreq.get(term) ?? 1));
          score += (1 + Math.log(tf)) * idf;
        }
        chunk.score = score;
      });
    }

    const picked = new Set<Chunk>();
    let used = 0;
    const take = (chunk: Chunk) => {
      if (picked.has(chunk) || used + chunk.text.length > budgetChars) return;
      picked.add(chunk);
      used += chunk.text.length;
    };

    const relevant = chunks.filter(c => c.score > 0).sort((a, b) => b.score - a.score);
    // Up to ~75% of the budget for the best matches, the rest spread over every document for context.
    for (const chunk of relevant) {
      if (used > budgetChars * 0.75) break;
      take(chunk);
    }
    const remaining = chunks.filter(c => !picked.has(c));
    if (remaining.length) {
      const slots = Math.max(1, Math.floor((budgetChars - used) / CHUNK_CHARS));
      const step = Math.max(1, remaining.length / slots);
      for (let i = 0; i < remaining.length; i += step) take(remaining[Math.floor(i)]);
    }

    const ordered = [...picked].sort((a, b) => a.docIndex - b.docIndex || a.position - b.position);
    let text = '';
    let lastDoc = -1;
    let lastPos = -2;
    for (const chunk of ordered) {
      if (chunk.docIndex !== lastDoc) {
        text += `${text ? '\n\n' : ''}### Document: ${docs[chunk.docIndex].title} (selected passages)\n`;
        lastPos = -2;
      } else if (chunk.position !== lastPos + 1) {
        text += '\n[…]\n';
      }
      text += `${chunk.text}\n`;
      lastDoc = chunk.docIndex;
      lastPos = chunk.position;
    }

    return { documents: docs.map(d => ({ id: d.id, title: d.title })), text, selected: true };
  }
}
