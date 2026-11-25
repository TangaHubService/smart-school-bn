import { pdfText, withLanguage } from '../../src/common/i18n/pdf-text';

describe('pdfText', () => {
  it('follows the language and leaves unknown text alone', () => {
    expect(pdfText('REPORT CARD')).toBe('REPORT CARD');
    expect(withLanguage('fr', () => pdfText('REPORT CARD'))).toBe('BULLETIN SCOLAIRE');
    expect(withLanguage('fr', () => pdfText('Term 3'))).toBe('Trimestre 3');
    expect(withLanguage('rw', () => pdfText('School Year: 2026'))).toBe("Umwaka w'amashuri: 2026");
    expect(withLanguage('rw', () => pdfText('Jean Habimana'))).toBe('Jean Habimana');
  });
});
