import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

import { PDF_TEXT_FR } from './pdf-text.fr';
import { PDF_TEXT_RW } from './pdf-text.rw';

export type AppLanguage = 'en' | 'fr' | 'rw';

const DICTIONARIES: Record<AppLanguage, Record<string, string>> = { en: {}, fr: PDF_TEXT_FR, rw: PDF_TEXT_RW };
const storage = new AsyncLocalStorage<AppLanguage>();

/** Remembers the language the person picked in the app, for PDFs made during this request. */
export function appLanguageMiddleware(req: Request, _res: Response, next: NextFunction) {
  const asked = req.header('x-app-language');
  storage.run(asked === 'fr' || asked === 'rw' ? asked : 'en', next);
}

/** Runs `fn` with a fixed language (used outside requests, e.g. tests). */
export function withLanguage<T>(language: AppLanguage, fn: () => T): T {
  return storage.run(language, fn);
}

/**
 * Translates a line printed on a PDF. English text is the key; anything unknown (names,
 * marks, comments typed by staff) is printed as it is. "Label: value" lines are
 * translated part by part.
 */
export function pdfText(value: string): string {
  const dict = DICTIONARIES[storage.getStore() ?? 'en'];
  if (value in dict) return dict[value];
  const term = /^Term (\d)$/.exec(value);
  if (term && dict.Term) return `${dict.Term} ${term[1]}`;
  const labelled = /^([A-Za-z ]+): (.+)$/s.exec(value);
  if (labelled && `${labelled[1]}:` in dict) return `${dict[`${labelled[1]}:`]} ${dict[labelled[2]] ?? labelled[2]}`;
  const generated = /^Generated (.+)$/.exec(value);
  if (generated && dict.Generated) return `${dict.Generated} ${generated[1]}`;
  return value;
}

/** Makes every doc.text(...) on a PDFKit document go through pdfText. */
export function localizePdf(doc: PDFKit.PDFDocument): PDFKit.PDFDocument {
  const original = doc.text.bind(doc) as (...args: unknown[]) => PDFKit.PDFDocument;
  // Bound now: PDFKit calls can run after the request context is gone.
  const language = storage.getStore() ?? 'en';
  doc.text = ((value: unknown, ...rest: unknown[]) =>
    original(typeof value === 'string' ? withLanguage(language, () => pdfText(value)) : value, ...rest)) as PDFKit.PDFDocument['text'];
  return doc;
}
