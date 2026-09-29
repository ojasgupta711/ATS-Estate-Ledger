// Zero-dependency spreadsheet reader for .xlsx and .csv files.
// .xlsx files are zip archives of XML; we unzip them with the browser's built-in
// DecompressionStream and read the shared strings, sheets and date formats.

export interface Sheet {
  name: string;
  rows: string[][];
}

export interface Workbook {
  fileName: string;
  sheets: Sheet[];
}

export async function readSpreadsheet(file: File): Promise<Workbook> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt') || file.type === 'text/csv') {
    const text = await file.text();
    return { fileName: file.name, sheets: [{ name: 'Sheet1', rows: parseCsv(text) }] };
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const buf = await file.arrayBuffer();
    return { fileName: file.name, sheets: await readXlsx(buf) };
  }
  if (lower.endsWith('.xls')) {
    throw new Error('Older .xls files are not supported. Open the file in Excel and save it as .xlsx or .csv.');
  }
  throw new Error('Unsupported file type. Please upload an .xlsx or .csv file.');
}

// ---------- CSV ----------

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', '\t', ';'].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return normalizeRows(rows.map((r) => r.map((c) => c.trim())));
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

/** Pads rows to equal width and drops trailing empty rows. */
function normalizeRows(rows: string[][]): string[][] {
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r));
}

// ---------- XLSX ----------

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  offset: number;
}

function readZipDirectory(buf: ArrayBuffer): Map<string, ZipEntry> {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file does not look like a valid .xlsx workbook.');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let i = 0; i < total; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.set(name, { name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipText(buf: ArrayBuffer, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf);
  const nameLen = dv.getUint16(e.offset + 26, true);
  const extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, e.compSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error(`Unsupported compression in ${e.name}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
}

/** Concatenates every <t> run inside a string item (handles rich text). */
function textRuns(xml: string): string {
  let out = '';
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += decodeXml(m[1] ?? '');
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function dateStyleIndexes(stylesXml: string): Set<number> {
  const customDate = new Set<number>();
  const numFmtRe = /<(?:\w+:)?numFmt\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = numFmtRe.exec(stylesXml))) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = (attr(m[0], 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
    if (/[dmy]/i.test(code) && !/^[#0.,\s$%]+$/.test(code)) customDate.add(id);
  }
  const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const out = new Set<number>();
  const xfRe = /<(?:\w+:)?xf\b[^>]*>/g;
  let i = 0;
  while ((m = xfRe.exec(xfs))) {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) out.add(i);
    i++;
  }
  return out;
}

export function excelSerialToIso(serial: number): string {
  // Excel's day 0 is 1899-12-30 (accounting for the 1900 leap-year bug).
  const ms = Math.round((serial - 25569) * 86_400_000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolvePath(target: string): string {
  const t = target.replace(/^\//, '');
  return t.startsWith('xl/') ? t : `xl/${t.replace(/^\.\//, '')}`;
}

export async function readXlsx(buf: ArrayBuffer): Promise<Sheet[]> {
  const zip = readZipDirectory(buf);
  const get = async (name: string) => {
    const e = zip.get(name);
    return e ? readZipText(buf, e) : '';
  };

  const [workbook, rels, sst, styles] = await Promise.all([
    get('xl/workbook.xml'),
    get('xl/_rels/workbook.xml.rels'),
    get('xl/sharedStrings.xml'),
    get('xl/styles.xml'),
  ]);
  if (!workbook) throw new Error('This file does not look like a valid .xlsx workbook.');

  const shared: string[] = [];
  const siRe = /<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>|<(?:\w+:)?si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(sst))) shared.push(textRuns(m[1] ?? ''));

  const dateStyles = dateStyleIndexes(styles);

  const relMap = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*>/g;
  while ((m = relRe.exec(rels))) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) relMap.set(id, resolvePath(target));
  }

  const sheets: Sheet[] = [];
  const sheetRe = /<(?:\w+:)?sheet\b[^>]*>/g;
  while ((m = sheetRe.exec(workbook))) {
    const name = attr(m[0], 'name') ?? `Sheet${sheets.length + 1}`;
    const rid = attr(m[0], 'r:id');
    const path = (rid && relMap.get(rid)) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    const xml = await get(path);
    sheets.push({ name, rows: parseSheetXml(xml, shared, dateStyles) });
  }
  return sheets;
}

function parseSheetXml(xml: string, shared: string[], dateStyles: Set<number>): string[][] {
  const rows: string[][] = [];
  const rowRe = /<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rm: RegExpExecArray | null;
  let nextRow = 0;
  while ((rm = rowRe.exec(xml))) {
    const r = Number(attr(rm[1], 'r') ?? nextRow + 1) - 1;
    nextRow = r + 1;
    const cells: string[] = [];
    const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cm: RegExpExecArray | null;
    let nextCol = 0;
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[1];
      const inner = cm[2] ?? '';
      const ref = attr(attrs, 'r');
      const col = ref ? colIndex(ref) : nextCol;
      nextCol = col + 1;
      const t = attr(attrs, 't');
      const s = Number(attr(attrs, 's') ?? -1);
      const v = /<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner)?.[1];
      let out = '';
      if (t === 's') out = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') out = textRuns(inner);
      else if (t === 'b') out = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) {
        out = decodeXml(v);
        if (t !== 'str' && t !== 'e' && dateStyles.has(s) && /^\d+(\.\d+)?$/.test(out)) out = excelSerialToIso(Number(out));
      }
      while (cells.length < col) cells.push('');
      cells[col] = out.trim();
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }
  return normalizeRows(rows);
}

/** Guesses which row holds the column headers (institution exports often have title rows first). */
export function detectHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].filter((c) => c !== '');
    const texty = cells.filter((c) => !/^[-$()\d.,%\s]+$/.test(c)).length;
    // Headers are mostly text and there should be data below them.
    const score = texty * 2 + cells.length - (i + 1 < rows.length ? 0 : 10);
    if (texty >= 2 && score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}
