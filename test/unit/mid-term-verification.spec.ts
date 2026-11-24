import { createMidTermToken, readMidTermToken } from '../../src/modules/exams/mid-term-verification';

const facts = {
  studentId: '11111111-1111-4111-8111-111111111111',
  termId: '22222222-2222-4222-8222-222222222222',
  classRoomId: '33333333-3333-4333-8333-333333333333',
  issuedAt: new Date('2026-11-24T08:00:00Z'),
  averagePercentage: 74.35,
  position: 3,
  classSize: 41,
  grade: 'B+',
};

describe('mid-term report QR token', () => {
  it('reads back exactly what was signed', () => {
    expect(readMidTermToken(createMidTermToken(facts))).toEqual(facts);
  });

  it('keeps "no marks yet" as no average', () => {
    const none = { ...facts, averagePercentage: null, position: 0, grade: '' };
    expect(readMidTermToken(createMidTermToken(none))).toEqual(none);
  });

  it('rejects an altered or malformed token', () => {
    const bytes = Buffer.from(createMidTermToken(facts).slice(3), 'base64url');
    bytes[54] ^= 1; // change the average
    expect(readMidTermToken(`mt-${bytes.toString('base64url')}`)).toBeNull();
    expect(readMidTermToken('mt-abc')).toBeNull();
    expect(readMidTermToken(facts.studentId)).toBeNull();
  });
});
