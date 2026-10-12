/** Template-preserving OOXML edits: retain original styles/layout, replace cell payloads only. */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const LIMIT = 64 * 1024 * 1024;
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function unzipWorkbook(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT) throw new Error('Invalid workbook size');
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Unsupported ZIP workbook');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16), total = 0;
  const parts = new Map();
  if (offset + bytes.readUInt32LE(end + 12) !== end || count > 4096) throw new Error('Invalid ZIP directory');
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP entry');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + length + extra + comment > end || local + 30 > offset) throw new Error('Truncated ZIP workbook');
    const name = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || parts.has(name) || flags & 1 || ![0, 8].includes(method)) throw new Error('Unsafe ZIP entry');
    total += size;
    if (total > LIMIT || size > LIMIT || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Workbook exceeds bounded ZIP support');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > offset) throw new Error('Truncated ZIP payload');
    const raw = bytes.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) }) : raw;
    if (data.length !== size || crc32(data) !== bytes.readUInt32LE(offset + 16)) throw new Error('Corrupt ZIP payload');
    parts.set(name, data);
    offset += 46 + length + extra + comment;
  }
  if (offset !== end || !parts.has('xl/workbook.xml')) throw new Error('Invalid OOXML workbook');
  return parts;
}
export function zipWorkbook(parts) {
  const chunks = [], directory = [];
  let offset = 0, total = 0;
  for (const [name, data] of parts) {
    total += data.length;
    if (total > LIMIT || parts.size > 4096) throw new Error('Workbook exceeds bounded ZIP support');
    const filename = Buffer.from(name), compressed = deflateRawSync(data), crc = crc32(data);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); // Earliest valid DOS date: 1980-01-01.
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(local, filename, compressed); directory.push(central, filename);
    offset += 30 + filename.length + compressed.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(parts.size, 8); end.writeUInt16LE(parts.size, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function assertXmlText(value, field = 'text') {
  for (const character of value) {
    const code = character.codePointAt(0);
    const allowed = code === 9 || code === 10 || code === 13
      || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd)
      || (code >= 0x10000 && code <= 0x10ffff);
    if (!allowed) throw new Error(`Invalid XML 1.0 character in ${field}: U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
  }
}
export function xmlEscape(value) {
  const text = String(value);
  assertXmlText(text);
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
}
export function columnName(index) {
  let s = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}
function payload(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return `<v>${value}</v>`;
  return `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`;
}
function cell(ref, value, attributes = '') {
  const body = payload(value);
  return `<c r="${ref}"${attributes}${body.startsWith('<is>') ? ' t="inlineStr"' : ''}>${body}</c>`;
}
/** Reject merged-data collisions rather than silently put values in invisible cells. */
export function setSheetCells(parts, part, values) {
  let text = parts.get(part)?.toString('utf8');
  if (!text || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`Invalid worksheet: ${part}`);
  const coordinate = (ref) => {
    const [, letters, row] = ref.match(/^([A-Z]+)(\d+)$/);
    return { col: [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row: Number(row) };
  };
  const merges = [...text.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)].map((m) => ({ start: coordinate(m[1]), end: coordinate(m[2]), anchor: m[1] }));
  const byRow = new Map();
  for (const [ref, value] of Object.entries(values)) {
    if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)) throw new Error('Invalid cell reference');
    const point = coordinate(ref);
    if (point.col > 16384 || point.row > 1048576) throw new Error('Cell exceeds Excel limits');
    if (payload(value) && merges.some((m) => ref !== m.anchor && point.row >= m.start.row && point.row <= m.end.row && point.col >= m.start.col && point.col <= m.end.col)) throw new Error(`Value would be hidden by merged cells: ${ref}`);
    if (!byRow.has(point.row)) byRow.set(point.row, new Map());
    byRow.get(point.row).set(ref, value);
  }
  const seen = new Set();
  // One worksheet pass avoids repeatedly scanning the entire XML for every data cell.
  text = text.replace(/(<row\b[^>]*>)(.*?)(<\/row>)/gs, (_, open, cells, close) => {
    const row = Number(open.match(/\br="(\d+)"/)?.[1]), wanted = byRow.get(row);
    if (!wanted) return open + cells + close;
    seen.add(row);
    const found = new Set();
    cells = cells.replace(/<c\b[^>]*?(?:\/>|>.*?<\/c>)/gs, (old) => {
      const ref = old.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!wanted.has(ref)) return old;
      found.add(ref);
      const attributes = old.match(/^<c\b([^>]*?)(?:\/?>)/)[1].replace(/\s+(?:r|t|vm|cm)="[^"]*"/g, '');
      if (/<f\b/.test(old)) throw new Error(`Cannot replace formula: ${ref}`);
      return cell(ref, wanted.get(ref), attributes);
    });
    for (const [ref, value] of wanted) {
      if (found.has(ref)) continue;
      const last = [...cells.matchAll(/<c\b[^>]*\bs="(\d+)"/g)].at(-1);
      const added = cell(ref, value, last ? ` s="${last[1]}"` : '');
      const next = [...cells.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*?(?:\/>|>.*?<\/c>)/gs)].find((m) => coordinate(m[1]).col > coordinate(ref).col);
      const index = next?.index ?? cells.length;
      cells = cells.slice(0, index) + added + cells.slice(index);
    }
    return open + cells + close;
  });
  for (const row of byRow.keys()) if (!seen.has(row)) throw new Error(`Missing template row: ${row}`);
  parts.set(part, Buffer.from(text));
}
export function extendSheetColumns(parts, part, firstColumn, lastColumn, width = 24) {
  const text = parts.get(part).toString('utf8');
  if (!/<cols>/.test(text)) throw new Error('Template column dimensions missing');
  const column = `<col min="${firstColumn}" max="${lastColumn}" width="${width}" customWidth="1"/>`;
  parts.set(part, Buffer.from(text.replace('</cols>', column + '</cols>')));
}
/** Fill a flat data table, extending with the original first data row's styles and height. */
export function fillSheetTable(parts, part, firstRow, data, { maxRows = 10000 } = {}) {
  if (data.length > maxRows) throw new Error(`Template row limit exceeded: ${maxRows}`);
  let text = parts.get(part)?.toString('utf8');
  const rows = [...text.matchAll(/<row\b[^>]*?(?:\/>|>.*?<\/row>)/gs)];
  const first = rows.find((m) => Number(m[0].match(/\br="(\d+)"/)[1]) === firstRow)?.[0];
  if (!first || first.endsWith('/>')) throw new Error('Missing styled data row');
  const last = Math.max(...rows.map((m) => Number(m[0].match(/\br="(\d+)"/)[1])));
  if (data.length && firstRow + data.length - 1 > last) {
    let more = '';
    for (let n = last + 1; n < firstRow + data.length; n++) more += first.replace(/\br="([A-Z]*)(\d+)"/g, (_, col) => `r="${col}${n}"`);
    text = text.replace('</sheetData>', more + '</sheetData>');
    parts.set(part, Buffer.from(text));
  }
  const values = {};
  data.forEach((row, i) => row.forEach((value, col) => { values[`${columnName(col)}${i + firstRow}`] = value; }));
  setSheetCells(parts, part, values);
  // The source Feishu exports report dimension=A1. Correct the used range, never change styling.
  text = parts.get(part).toString('utf8');
  let maxCol = 1, maxRow = 1;
  for (const match of text.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
    const col = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, Number(match[2]));
  }
  parts.set(part, Buffer.from(text.replace(/<dimension\b[^>]*?(?:\/>|>.*?<\/dimension>)/s, `<dimension ref="A1:${columnName(maxCol - 1)}${maxRow}"/>`)));
}
