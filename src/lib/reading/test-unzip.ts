import { crc32, inflateRawSync } from 'node:zlib';

/**
 * A zip reader for tests, the way an unzip tool reads one: the end record, then the central directory, then each
 * local entry; checks every crc. Lives outside a .test.ts so importing it doesn't rerun a test file.
 */
export function unzip(zip: Uint8Array): { path: string; text: string; date: Date; flags: number }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.byteLength - 22;
  if (v.getUint32(end, true) !== 0x06054b50) throw new Error('no end record');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('no central entry');
    const flags = v.getUint16(at + 8, true);
    if (v.getUint16(at + 10, true) !== 8) throw new Error('not deflated');
    const [time, day] = [v.getUint16(at + 12, true), v.getUint16(at + 14, true)];
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const path = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error('no local header');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = inflateRawSync(zip.subarray(start, start + size));
    if (crc32(data) !== crc) throw new Error(`bad crc: ${path}`);
    const date = new Date(
      Date.UTC((day >> 9) + 1980, ((day >> 5) & 15) - 1, day & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2),
    );
    out.push({ path, text: data.toString('utf8'), date, flags });
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  return out;
}
