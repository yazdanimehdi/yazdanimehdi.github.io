import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A zip of text files: each deflated (method 8), names flagged UTF-8 (bit 11), times as DOS date and time in UTC.
 * No zip64: callers stay under EXPORT_MAX, far below 4 GB and 65 535 entries.
 */
export function zip(files: { path: string; text: string; date: Date }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path, 'utf8');
    const raw = Buffer.from(f.text, 'utf8');
    const data = deflateRawSync(raw);
    const d = f.date;
    const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
    const day = (Math.max(d.getUTCFullYear() - 1980, 0) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
    // Shared by both headers: version needed 2.0, flags, method, time, date, crc, sizes, name length.
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0);
    common.writeUInt16LE(0x800, 2);
    common.writeUInt16LE(8, 4);
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(day, 8);
    common.writeUInt32LE(crc32(raw), 10);
    common.writeUInt32LE(data.length, 14);
    common.writeUInt32LE(raw.length, 18);
    common.writeUInt16LE(name.length, 22); // extra length 0 follows
    const local = Buffer.alloc(4);
    local.writeUInt32LE(0x04034b50, 0);
    parts.push(local, common, name, data);
    const head = Buffer.alloc(6);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(0x0314, 4); // made by Unix, 2.0: Info-ZIP unzip reads a DOS host's names as CP437
    const tail = Buffer.alloc(14); // comment length, disk, internal attributes 0; mode; the local header's offset
    tail.writeUInt32LE((0o100644 << 16) >>> 0, 6); // a regular file, rw-r--r--
    tail.writeUInt32LE(offset, 10);
    central.push(head, common, tail, name);
    offset += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
