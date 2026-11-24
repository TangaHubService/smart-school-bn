import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../config/env';

/**
 * Mid-term reports are built live and never stored, so their QR code carries the
 * printed result itself, signed by the server. A scan shows what was printed even if
 * marks change later, and an altered code fails the signature check.
 */
export interface MidTermVerification {
  studentId: string;
  termId: string;
  classRoomId: string;
  issuedAt: Date;
  /** null when the student had no marks yet. */
  averagePercentage: number | null;
  position: number;
  classSize: number;
  grade: string;
}

const PREFIX = 'mt-';
const VERSION = 1;
const HEADER_BYTES = 59;
const SIGNATURE_BYTES = 16;
const NO_AVERAGE = 0xffff;

function sign(body: Buffer) {
  return createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update('mid-term-report-qr:')
    .update(body)
    .digest()
    .subarray(0, SIGNATURE_BYTES);
}

const uuidBytes = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex');

function uuidString(bytes: Buffer) {
  return bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

export function isMidTermToken(value: string) {
  return value.startsWith(PREFIX);
}

export function createMidTermToken(data: MidTermVerification) {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt8(VERSION, 0);
  uuidBytes(data.studentId).copy(header, 1);
  uuidBytes(data.termId).copy(header, 17);
  uuidBytes(data.classRoomId).copy(header, 33);
  header.writeUInt32BE(Math.floor(data.issuedAt.getTime() / 1000), 49);
  header.writeUInt16BE(
    data.averagePercentage == null ? NO_AVERAGE : Math.round(data.averagePercentage * 100),
    53
  );
  header.writeUInt16BE(data.position, 55);
  header.writeUInt16BE(data.classSize, 57);
  const body = Buffer.concat([header, Buffer.from(data.grade, 'utf8')]);
  return PREFIX + Buffer.concat([body, sign(body)]).toString('base64url');
}

/** The signed facts, or null when the code is malformed or was altered. */
export function readMidTermToken(token: string): MidTermVerification | null {
  if (!isMidTermToken(token)) return null;
  const bytes = Buffer.from(token.slice(PREFIX.length), 'base64url');
  if (bytes.length < HEADER_BYTES + SIGNATURE_BYTES) return null;
  const body = bytes.subarray(0, bytes.length - SIGNATURE_BYTES);
  if (!timingSafeEqual(bytes.subarray(body.length), sign(body)) || body.readUInt8(0) !== VERSION) return null;
  const average = body.readUInt16BE(53);
  return {
    studentId: uuidString(body.subarray(1, 17)),
    termId: uuidString(body.subarray(17, 33)),
    classRoomId: uuidString(body.subarray(33, 49)),
    issuedAt: new Date(body.readUInt32BE(49) * 1000),
    averagePercentage: average === NO_AVERAGE ? null : average / 100,
    position: body.readUInt16BE(55),
    classSize: body.readUInt16BE(57),
    grade: body.subarray(HEADER_BYTES).toString('utf8'),
  };
}
