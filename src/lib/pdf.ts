// Estate Summary PDF — modeled on the ATS "Estate Summary" worksheet:
// letterhead, highlighted total, colored section headers with $ subtotals,
// two columns of trusts/categories, and an optional detail appendix.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import type { Account, AppData, Client, EstateNode } from '../types';
import { NODE_COLORS } from '../types';
import { childAccounts, childNodes, crtRunningTotals, estateSummary, isAccountExcluded, nodeSelfExcluded, nodeTotals, normalizeScope, type EstateScope } from './calc';
import { fmtDate } from './format';
import { ATS_LOGO_DATA_URL } from '../data/logo';

export interface ReportOptions {
  reportDate: string; // yyyy-mm-dd
  accountNumbers: 'last4' | 'full' | 'hidden';
  includeDistributions: boolean;
  includeNotes: boolean;
  includeCrtSchedule: boolean;
  includeAppendix: boolean;
  internalUse: boolean;
  fitOnePage: boolean;
}

export const defaultReportOptions = (date: string, internalUse: boolean): ReportOptions => ({
  reportDate: date,
  accountNumbers: 'last4',
  includeDistributions: true,
  includeNotes: true,
  includeCrtSchedule: true,
  includeAppendix: true,
  internalUse,
  fitOnePage: true,
});

// ---------- helpers ----------

const W = 792; // Letter landscape
const H = 612;
const M = 36;
const GUTTER = 28;
const COL_W = (W - M * 2 - GUTTER) / 2;
const FOOTER = 30;

const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const NAVY = hex('#1f3a5f');
const INK = hex('#1e293b');
const MUTED = hex('#64748b');
const RULE = hex('#94a3b8');
const MAROON = hex('#8c1d2c');
const YELLOW = hex('#f5e663');
const GREY = hex('#d9dbe0');
const LIGHT = hex('#f1f5f9');

/** Standard PDF fonts only cover WinAnsi — map typographic characters to safe ones. */
export function pdfText(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[•·]/g, '-')
    .replace(/↳|→/g, '>')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E -ÿ]/g, '');
}

const num0 = (v: number) => Math.round(v).toLocaleString('en-US');
const num2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (v: number) => `$${num0(v)}`;

function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  let t = pdfText(text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/).map(pdfText)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function accountLabel(a: Account, mode: ReportOptions['accountNumbers']): string {
  if (mode === 'hidden' || !a.number.trim()) return a.name;
  if (mode === 'full') return `${a.name} - ${a.number}`;
  const d = a.number.replace(/\D/g, '');
  return d.length >= 4 ? `${a.name} - ${d.slice(-4)}` : `${a.name} - ${a.number}`;
}

interface Fonts {
  reg: PDFFont;
  bold: PDFFont;
  ital: PDFFont;
  serif: PDFFont;
  serifBold: PDFFont;
}

/** One drawable line/row in a column. Heights are known up front so layout can paginate. */
interface Item {
  h: number;
  keepWithNext?: boolean;
  draw: (page: PDFPage, x: number, top: number) => void;
}

// ---------- document ----------

export async function buildEstatePdf(data: AppData, client: Client, opts: ReportOptions): Promise<Uint8Array> {
  const scope: EstateScope = normalizeScope({
    nodes: data.nodes.filter((n) => n.clientId === client.id),
    accounts: data.accounts.filter((a) => a.clientId === client.id),
  });
  const summary = estateSummary(scope, data.accountTypes);
  const doc = await PDFDocument.create();
  doc.setTitle(`${client.estateName} Summary`);
  doc.setAuthor(data.settings.firmName || 'ATS');
  doc.setSubject('Estate Summary');
  doc.setCreator('ATS Estate Ledger');

  const f: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
    serifBold: await doc.embedFont(StandardFonts.TimesRomanBold),
  };

  // A logo uploaded in Settings replaces the whole letterhead mark; otherwise the ATS tree + wordmark is used.
  const embedDataUrl = async (url: string): Promise<PDFImage | null> => {
    try {
      const [meta, b64] = url.split(',');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return meta.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      return null;
    }
  };
  const customLogo = data.settings.logoDataUrl ? await embedDataUrl(data.settings.logoDataUrl) : null;
  const treeLogo = customLogo ? null : await embedDataUrl(ATS_LOGO_DATA_URL);

  const reportDateLabel = (() => {
    const [y, m, d] = opts.reportDate.split('-').map(Number);
    return y ? `${m}/${d}/${y}` : opts.reportDate;
  })();

  // ----- page management -----
  const pages: PDFPage[] = [];
  const HEADER_H = 118; // first page letterhead
  const CONT_H = 44; // continuation pages
  const pageAt = (i: number) => {
    while (pages.length <= i) {
      const p = doc.addPage([W, H]);
      if (pages.length === 0) drawLetterhead(p);
      else drawContinuation(p);
      pages.push(p);
    }
    return pages[i];
  };
  const bodyTop = (i: number) => H - M - (i === 0 ? HEADER_H : CONT_H);
  const bodyBottom = M + FOOTER;

  function drawLetterhead(p: PDFPage) {
    const top = H - M;
    // Logo / wordmark
    if (customLogo) {
      const sc = Math.min(150 / customLogo.width, 52 / customLogo.height);
      p.drawImage(customLogo, { x: M, y: top - customLogo.height * sc, width: customLogo.width * sc, height: customLogo.height * sc });
    } else {
      let x = M;
      if (treeLogo) {
        const h = 50;
        const w = (treeLogo.width / treeLogo.height) * h;
        p.drawImage(treeLogo, { x, y: top - h - 2, width: w, height: h });
        x += w + 8;
      }
      p.drawText(pdfText(data.settings.firmName || 'ATS'), { x, y: top - 38, size: 30, font: f.serifBold, color: MAROON });
      p.drawText(pdfText((data.settings.firmTagline || '').toUpperCase()), { x: M, y: top - 66, size: 8.5, font: f.serifBold, color: MAROON });
    }
    // Title with rule
    const title = pdfText(`${client.estateName} Summary`);
    const titleSize = 16;
    const tw = f.bold.widthOfTextAtSize(title, titleSize);
    const ruleX = M + 175;
    const tx = ruleX + (W - M - ruleX - tw) / 2;
    p.drawText(title, { x: tx, y: top - 40, size: titleSize, font: f.bold, color: NAVY });
    p.drawLine({ start: { x: ruleX, y: top - 47 }, end: { x: W - M, y: top - 47 }, thickness: 1.5, color: NAVY });
    // Internal-use badge
    if (opts.internalUse) {
      const label = `Internal Use Only ${reportDateLabel}`;
      const lw = f.bold.widthOfTextAtSize(label, 8.5) + 14;
      p.drawRectangle({ x: W - M - lw, y: top - 16, width: lw, height: 14, color: YELLOW });
      p.drawText(label, { x: W - M - lw + 7, y: top - 12, size: 8.5, font: f.bold, color: hex('#b91c1c') });
    } else {
      const label = `As of ${reportDateLabel}`;
      p.drawText(label, { x: W - M - f.reg.widthOfTextAtSize(label, 9), y: top - 12, size: 9, font: f.reg, color: MUTED });
    }
    // Total
    const totalTxt = `$ ${num0(summary.total)}`;
    const bw = f.bold.widthOfTextAtSize(totalTxt, 13) + 20;
    p.drawRectangle({ x: W - M - bw, y: top - 86, width: bw, height: 20, color: YELLOW });
    p.drawText(totalTxt, { x: W - M - bw + 10, y: top - 80, size: 13, font: f.bold, color: INK });
    p.drawText('Total', { x: W - M - bw - 60, y: top - 80, size: 11, font: f.bold, color: INK });
    p.drawLine({ start: { x: W - M - bw - 110, y: top - 90 }, end: { x: W - M - bw - 10, y: top - 90 }, thickness: 1, color: NAVY });
    if (summary.excludedCount > 0) {
      const note = pdfText(`Excludes ${usd0(summary.excludedTotal)} shown for reference`);
      p.drawText(note, { x: W - M - f.ital.widthOfTextAtSize(note, 7.5), y: top - 101, size: 7.5, font: f.ital, color: MUTED });
    }
  }

  function drawContinuation(p: PDFPage) {
    const top = H - M;
    p.drawText(pdfText(`${client.estateName} Summary (continued)`), { x: M, y: top - 14, size: 11, font: f.bold, color: NAVY });
    p.drawLine({ start: { x: M, y: top - 22 }, end: { x: W - M, y: top - 22 }, thickness: 1, color: NAVY });
  }

  // ----- section items -----
  const valX = (x: number, cw: number) => x + cw - 110; // "$" column

  function moneyCells(p: PDFPage, x: number, cw: number, y: number, v: number | null, size: number, font: PDFFont, blankZeroAsDash = true, cents = false) {
    p.drawText('$', { x: valX(x, cw), y, size, font, color: INK });
    const t = v === null ? '' : v === 0 && blankZeroAsDash ? '-' : cents ? num2(v) : num0(v);
    p.drawText(t, { x: x + cw - 4 - font.widthOfTextAtSize(t, size), y, size, font, color: INK });
  }

  function sectionItems(node: EstateNode | null, depthLabel: string | null, cw: number): Item[] {
    const items: Item[] = [];
    const name = node ? node.name : 'Other Accounts';
    const color = hex(node ? NODE_COLORS[node.color]?.hex ?? '#c9d1e3' : NODE_COLORS.rose.hex);
    const accts = node ? childAccounts(scope, node.id) : scope.accounts.filter((a) => a.parentId === null);
    const t = node ? nodeTotals(scope, node.id) : null;
    const direct = node ? t!.direct : accts.reduce((s, a) => s + (a.value ?? 0), 0);
    const hasKids = node ? childNodes(scope, node.id).length > 0 : false;

    if (depthLabel) {
      items.push({
        h: 11,
        keepWithNext: true,
        draw: (p, x, top) => p.drawText(fit(f.ital, depthLabel, 7.5, cw), { x, y: top - 8, size: 7.5, font: f.ital, color: MUTED }),
      });
    }

    // Header bar: colored name + grey value box
    items.push({
      h: 24,
      keepWithNext: true,
      draw: (p, x, top) => {
        const boxW = 118;
        p.drawRectangle({ x, y: top - 20, width: cw - boxW, height: 20, color });
        p.drawRectangle({ x: x + cw - boxW, y: top - 20, width: boxW, height: 20, color: GREY });
        p.drawLine({ start: { x, y: top - 21 }, end: { x: x + cw, y: top - 21 }, thickness: 1.2, color: NAVY });
        const size = name.length > 40 ? 9.5 : 12;
        const label = fit(f.bold, name, size, cw - boxW - 12);
        const lw = f.bold.widthOfTextAtSize(label, size);
        p.drawText(label, { x: x + (cw - boxW - lw) / 2, y: top - 14.5, size, font: f.bold, color: INK });
        if (!accts.length && !hasKids) {
          const z = '$0';
          p.drawText(z, { x: x + cw - 6 - f.bold.widthOfTextAtSize(z, 14), y: top - 15, size: 14, font: f.bold, color: INK });
        } else {
          p.drawText('$', { x: x + cw - boxW + 6, y: top - 14.5, size: 11, font: f.bold, color: INK });
          const v = direct === 0 ? '-' : num0(direct);
          p.drawText(v, { x: x + cw - 6 - f.bold.widthOfTextAtSize(v, 11), y: top - 14.5, size: 11, font: f.bold, color: INK });
        }
      },
    });

    if (node && nodeSelfExcluded(node)) {
      items.push({
        h: 11,
        keepWithNext: true,
        draw: (p, x, top) => p.drawText('Shown for reference - not included in the estate total', { x: x + 2, y: top - 8, size: 7, font: f.ital, color: hex('#6d28d9') }),
      });
    }

    if (accts.length) {
      items.push({
        h: 14,
        keepWithNext: true,
        draw: (p, x, top) => {
          const a = 'Accounts';
          p.drawText(a, { x: x + (cw - 110 - f.bold.widthOfTextAtSize(a, 8.5)) / 2, y: top - 10, size: 8.5, font: f.bold, color: INK });
          p.drawText('Value', { x: x + cw - 60, y: top - 10, size: 8.5, font: f.bold, color: INK });
          p.drawLine({ start: { x, y: top - 13 }, end: { x: x + cw, y: top - 13 }, thickness: 0.8, color: NAVY });
        },
      });
      accts.forEach((a, i) => {
        const sub: string[] = [];
        if (opts.includeDistributions && a.distributionAmount) sub.push(`Distribution ${usd0(a.distributionAmount)} ${a.distributionFrequency || ''}`.trim());
        const excluded = isAccountExcluded(scope.nodes, a) && !(node && nodeSelfExcluded(node));
        if (excluded) sub.push('not in total');
        const noteLines = opts.includeNotes && a.notes ? wrap(f.ital, a.notes, 7.5, cw - 20).slice(0, 3) : [];
        const last = i === accts.length - 1;
        const h = 13 + (sub.length ? 9 : 0) + noteLines.length * 10 + (noteLines.length ? 3 : 0);
        items.push({
          h,
          draw: (p, x, top) => {
            p.drawText(fit(f.bold, accountLabel(a, opts.accountNumbers), 9, cw - 125), { x: x + 2, y: top - 10, size: 9, font: f.bold, color: INK });
            moneyCells(p, x, cw, top - 10, a.value, 9, f.reg);
            let y = top - 13;
            if (sub.length) {
              p.drawText(fit(f.reg, sub.join('  |  '), 7, cw - 125), { x: x + 10, y: y - 7, size: 7, font: f.reg, color: MUTED });
              y -= 9;
            }
            if (noteLines.length) {
              const bw = Math.min(cw - 40, Math.max(...noteLines.map((l) => f.ital.widthOfTextAtSize(l, 7.5))) + 24);
              p.drawRectangle({ x: x + (cw - bw) / 2, y: y - noteLines.length * 10 - 1, width: bw, height: noteLines.length * 10 + 1, color: hex('#f3d9c4') });
              noteLines.forEach((l, j) => {
                const lw = f.ital.widthOfTextAtSize(l, 7.5);
                p.drawText(l, { x: x + (cw - lw) / 2, y: y - 8 - j * 10, size: 7.5, font: f.ital, color: INK });
              });
              y -= noteLines.length * 10 + 3;
            }
            p.drawLine({ start: { x, y: top - h + 1 }, end: { x: x + cw, y: top - h + 1 }, thickness: last ? 0.9 : 0.3, color: last ? NAVY : RULE });
          },
        });
      });
    }

    if (node && hasKids && t) {
      items.push({
        h: 14,
        draw: (p, x, top) => {
          const label = `Including sub-trusts below: ${usd0(t.rollupIncluded)}${t.rollup !== t.rollupIncluded ? ` (+${usd0(t.rollup - t.rollupIncluded)} not in total)` : ''}`;
          p.drawText(fit(f.ital, label, 7.5, cw - 4), { x: x + cw - 2 - Math.min(cw - 4, f.ital.widthOfTextAtSize(pdfText(label), 7.5)), y: top - 10, size: 7.5, font: f.ital, color: NAVY });
        },
      });
    }

    if (node && opts.includeDistributions && node.distributionInfo.trim()) {
      const lines = wrap(f.bold, node.distributionInfo, 8, cw - 10);
      items.push({ h: 5, draw: () => {} });
      lines.forEach((l) =>
        items.push({
          h: 11,
          draw: (p, x, top) => p.drawText(l, { x: x + 4, y: top - 9, size: 8, font: f.bold, color: INK }),
        }),
      );
    }
    if (node && opts.includeNotes && node.notes.trim()) {
      wrap(f.ital, node.notes, 7.5, cw - 10).forEach((l) =>
        items.push({ h: 10, draw: (p, x, top) => p.drawText(l, { x: x + 4, y: top - 8, size: 7.5, font: f.ital, color: MUTED }) }),
      );
    }

    if (node?.crt && opts.includeCrtSchedule) {
      const c = node.crt;
      const run = crtRunningTotals(c.rows);
      items.push({ h: 6, draw: () => {} });
      items.push({
        h: 34,
        keepWithNext: true,
        draw: (p, x, top) => {
          const s = 7.5;
          const w = cw;
          p.drawText('Initial Value', { x: x + w * 0.2, y: top - 8, size: s, font: f.reg, color: MUTED });
          p.drawText('Payout:', { x: x + w * 0.55, y: top - 8, size: s, font: f.reg, color: MUTED });
          p.drawText(pdfText(`FMV as of ${fmtDate(c.fmvAsOfDate)}`), { x: x + w * 0.74, y: top - 8, size: s, font: f.reg, color: MUTED });
          const d = c.initialDate ? c.initialDate.split('-').map(Number) : null;
          p.drawText(d ? `${d[1]}/${d[2]}/${d[0]}  $` : '$', { x: x + 2, y: top - 19, size: s, font: f.reg, color: INK });
          const iv = c.initialValue !== null ? num2(c.initialValue) : '';
          p.drawText(iv, { x: x + w * 0.5 - f.reg.widthOfTextAtSize(iv, s), y: top - 19, size: s, font: f.reg, color: INK });
          const pr = c.payoutRate !== null ? `${c.payoutRate.toFixed(2)}%` : '';
          p.drawText(pr, { x: x + w * 0.68 - f.reg.widthOfTextAtSize(pr, s), y: top - 19, size: s, font: f.reg, color: INK });
          const fv = c.fmvAsOf !== null ? `$ ${num2(c.fmvAsOf)}` : '';
          p.drawText(fv, { x: x + w - 2 - f.reg.widthOfTextAtSize(fv, s), y: top - 19, size: s, font: f.reg, color: INK });
          p.drawText('Net Proceeds', { x: x + 2, y: top - 30, size: s, font: f.reg, color: MUTED });
          const np = c.netProceeds !== null ? `$${num2(c.netProceeds)}` : '';
          p.drawText(np, { x: x + w * 0.5 - f.reg.widthOfTextAtSize(np, s), y: top - 30, size: s, font: f.reg, color: INK });
        },
      });
      items.push({
        h: 13,
        keepWithNext: true,
        draw: (p, x, top) => {
          const s = 7.5;
          p.drawText('Year', { x: x + 2, y: top - 10, size: s, font: f.reg, color: MUTED });
          p.drawText('FMV', { x: x + cw * 0.3, y: top - 10, size: s, font: f.reg, color: MUTED });
          p.drawText('Distribution by end of year', { x: x + cw * 0.44, y: top - 10, size: s, font: f.reg, color: MUTED });
          p.drawText('Running total distributions', { x: x + cw * 0.72, y: top - 10, size: s, font: f.reg, color: MUTED });
          p.drawLine({ start: { x, y: top - 12.5 }, end: { x: x + cw, y: top - 12.5 }, thickness: 0.3, color: RULE });
        },
      });
      c.rows.forEach((r, i) =>
        items.push({
          h: 10,
          draw: (p, x, top) => {
            const s = 7.5;
            const y = top - 8;
            p.drawText(String(r.year), { x: x + 2, y, size: s, font: f.reg, color: INK });
            const cells: [number | null, number][] = [
              [r.fmv, 0.42],
              [r.distribution, 0.68],
              [run[i], 1],
            ];
            cells.forEach(([v, right], j) => {
              const t = v === null ? '' : num2(v);
              const rx = x + cw * right - 2;
              p.drawText('$', { x: x + cw * [0.24, 0.5, 0.76][j], y, size: s, font: f.reg, color: MUTED });
              p.drawText(t, { x: rx - f.reg.widthOfTextAtSize(t, s), y, size: s, font: f.reg, color: INK });
            });
          },
        }),
      );
    }

    items.push({ h: 16, draw: () => {} }); // spacing after section
    return items;
  }

  // Top-level groups: each node followed by its sub-trusts (depth-first).
  function layoutColumns(cw: number) {
    const groups: { items: Item[]; pref: EstateNode['reportColumn'] }[] = [];
    const walk = (n: EstateNode, parentName: string | null, acc: Item[]) => {
      acc.push(...sectionItems(n, parentName ? `Created under ${parentName}` : null, cw));
      for (const k of childNodes(scope, n.id)) walk(k, n.name, acc);
    };
    for (const n of childNodes(scope, null)) {
      const acc: Item[] = [];
      walk(n, null, acc);
      groups.push({ items: acc, pref: n.reportColumn });
    }
    if (scope.accounts.some((a) => a.parentId === null)) groups.push({ items: sectionItems(null, null, cw), pref: 'auto' });

    // Balance columns: honor explicit preferences, fill "auto" into the shorter column.
    const heights = [0, 0];
    const cols: Item[][] = [[], []];
    for (const g of groups) {
      const h = g.items.reduce((sum, i) => sum + i.h, 0);
      const c = g.pref === 'left' ? 0 : g.pref === 'right' ? 1 : heights[0] <= heights[1] ? 0 : 1;
      cols[c].push(...g.items);
      heights[c] += h;
    }
    // Trailing spacer does not need room.
    return { cols, height: Math.max(...heights) - 16 };
  }

  pageAt(0);
  const available = bodyTop(0) - bodyBottom;

  // Like the worksheet, try to keep the summary on one page by scaling it down slightly.
  let fitted = false;
  if (opts.fitOnePage) {
    for (let scale = 1; scale >= 0.66; scale -= 0.02) {
      const cw = COL_W / scale;
      const { cols, height } = layoutColumns(cw);
      if (height > available / scale) continue;
      if (scale === 1) {
        cols.forEach((items, c) => {
          let y = bodyTop(0);
          for (const it of items) {
            it.draw(pages[0], M + c * (COL_W + GUTTER), y);
            y -= it.h;
          }
        });
      } else {
        const vw = (W - 2 * M) / scale;
        const vh = available / scale;
        const temp = doc.addPage([vw, vh]);
        cols.forEach((items, c) => {
          let y = vh;
          for (const it of items) {
            it.draw(temp, c * (cw + GUTTER / scale), y);
            y -= it.h;
          }
        });
        const embedded = await doc.embedPage(temp);
        pages[0].drawPage(embedded, { x: M, y: bodyBottom, xScale: scale, yScale: scale });
        doc.removePage(doc.getPageCount() - 1);
      }
      fitted = true;
      break;
    }
  }

  // Otherwise flow each column independently across pages.
  if (!fitted) {
    const { cols } = layoutColumns(COL_W);
    cols.forEach((items, c) => {
      const x = M + c * (COL_W + GUTTER);
      let pi = 0;
      let y = bodyTop(0);
      for (let i = 0; i < items.length; i++) {
        // Keep headers with the first row that follows them.
        let need = items[i].h;
        for (let j = i; items[j]?.keepWithNext && j + 1 < items.length; j++) need += items[j + 1].h;
        if (y - need < bodyBottom && y < bodyTop(pi)) {
          pi++;
          pageAt(pi);
          y = bodyTop(pi);
        }
        items[i].draw(pageAt(pi), x, y);
        y -= items[i].h;
      }
    });
  }

  if (summary.unassignedCount === 0 && scope.accounts.length === 0) {
    pages[0].drawText('No accounts have been added to this estate yet.', { x: M, y: bodyTop(0) - 20, size: 11, font: f.ital, color: MUTED });
  }

  // ----- appendix -----
  if (opts.includeAppendix && scope.accounts.length) drawAppendix();

  function drawAppendix() {
    const cols: { label: string; w: number; right?: boolean; get: (a: Account) => string }[] = [
      { label: 'Account', w: 140, get: (a) => a.name },
      { label: 'Number', w: 42, get: (a) => (opts.accountNumbers === 'hidden' ? '' : opts.accountNumbers === 'full' ? a.number : a.number.replace(/\D/g, '').slice(-4)) },
      { label: 'Institution', w: 72, get: (a) => a.institution },
      { label: 'Type', w: 62, get: (a) => a.type },
      { label: 'Trust / Category', w: 110, get: (a) => scope.nodes.find((n) => n.id === a.parentId)?.name ?? 'Unassigned' },
      { label: 'Value / FMV', w: 64, right: true, get: (a) => (a.value === null ? '-' : num2(a.value)) },
      { label: 'Distribution', w: 70, right: true, get: (a) => (a.distributionAmount ? `${num0(a.distributionAmount)} ${(a.distributionFrequency || '').replace('Semi-Annual', 'Semi')}` : '') },
      { label: 'As of', w: 44, get: (a) => (a.lastUpdated ? a.lastUpdated.slice(5).replace('-', '/') + '/' + a.lastUpdated.slice(2, 4) : '') },
      { label: 'Source', w: 110, get: (a) => (a.source.kind === 'import' ? a.source.fileName ?? 'Import' : 'Manual entry') },
    ];
    let p = doc.addPage([W, H]);
    pages.push(p);
    let y = H - M;
    const header = (cont: boolean) => {
      p.drawText(pdfText(`${client.estateName} - Account Detail${cont ? ' (continued)' : ''}`), { x: M, y: y - 14, size: 12, font: f.bold, color: NAVY });
      p.drawLine({ start: { x: M, y: y - 21 }, end: { x: W - M, y: y - 21 }, thickness: 1, color: NAVY });
      y -= 34;
      let x = M;
      p.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 14, color: LIGHT });
      for (const c of cols) {
        const tx = c.right ? x + c.w - 4 - f.bold.widthOfTextAtSize(c.label, 7) : x + 2;
        p.drawText(c.label, { x: tx, y, size: 7, font: f.bold, color: MUTED });
        x += c.w;
      }
      y -= 14;
    };
    header(false);
    // Same order as the hierarchy: depth-first through trusts, then unassigned.
    const nodeOrder = new Map<string, number>();
    const visit = (parent: string | null) => {
      for (const n of childNodes(scope, parent)) {
        nodeOrder.set(n.id, nodeOrder.size);
        visit(n.id);
      }
    };
    visit(null);
    const ordered = [...scope.accounts].sort((a, b) => {
      const na = a.parentId ? nodeOrder.get(a.parentId) ?? 999 : 999;
      const nb = b.parentId ? nodeOrder.get(b.parentId) ?? 999 : 999;
      return na - nb || (b.value ?? 0) - (a.value ?? 0);
    });
    for (const a of ordered) {
      if (y < bodyBottom + 10) {
        p = doc.addPage([W, H]);
        pages.push(p);
        y = H - M;
        header(true);
      }
      let x = M;
      const excluded = isAccountExcluded(scope.nodes, a);
      for (const c of cols) {
        const t = fit(f.reg, c.get(a), 7, c.w - 6);
        const tx = c.right ? x + c.w - 4 - f.reg.widthOfTextAtSize(t, 7) : x + 2;
        p.drawText(t, { x: tx, y, size: 7, font: f.reg, color: excluded ? MUTED : INK });
        x += c.w;
      }
      p.drawLine({ start: { x: M, y: y - 3.5 }, end: { x: W - M, y: y - 3.5 }, thickness: 0.25, color: RULE });
      y -= 12;
    }
    // Totals blocks
    y -= 10;
    const block = (title: string, rows: [string, string][], x: number, top: number) => {
      p.drawText(title, { x, y: top, size: 8.5, font: f.bold, color: NAVY });
      let yy = top - 12;
      for (const [l, v] of rows) {
        p.drawText(fit(f.reg, l, 7.5, 150), { x, y: yy, size: 7.5, font: f.reg, color: INK });
        p.drawText(v, { x: x + 230 - f.reg.widthOfTextAtSize(v, 7.5), y: yy, size: 7.5, font: f.reg, color: INK });
        yy -= 10;
      }
      return top - yy;
    };
    const typeRows: [string, string][] = summary.byType.filter((b) => b.count).map((b) => [`${b.key} (${b.count})`, usd0(b.value)]);
    typeRows.push(['Total estate value', usd0(summary.total)]);
    const instRows: [string, string][] = summary.byInstitution.map((b) => [`${b.key} (${b.count})`, usd0(b.value)]);
    const distRows: [string, string][] = [
      ['Accounts on file', String(summary.accountCount)],
      ['Accounts in estate total', String(summary.includedCount)],
      ['Annualized distributions', usd0(summary.distributionsAnnual)],
    ];
    if (summary.excludedCount) distRows.push(['Excluded from total (reference only)', usd0(summary.excludedTotal)]);
    const needed = Math.max(typeRows.length, instRows.length, distRows.length) * 10 + 20;
    if (y - needed < bodyBottom) {
      p = doc.addPage([W, H]);
      pages.push(p);
      y = H - M - 20;
    }
    block('Totals by account type', typeRows, M, y);
    block('Totals by institution', instRows, M + 250, y);
    block('Summary', distRows, M + 500, y);
  }

  // ----- footers -----
  const generated = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  pages.forEach((p, i) => {
    const left = pdfText(`${data.settings.firmName || 'ATS'} ${data.settings.firmTagline ? `- ${data.settings.firmTagline}` : ''}  |  Report date ${reportDateLabel}  |  Generated ${generated}`);
    p.drawLine({ start: { x: M, y: M + 14 }, end: { x: W - M, y: M + 14 }, thickness: 0.4, color: RULE });
    p.drawText(left, { x: M, y: M + 4, size: 7, font: f.reg, color: MUTED });
    const right = `Page ${i + 1} of ${pages.length}`;
    p.drawText(right, { x: W - M - f.reg.widthOfTextAtSize(right, 7), y: M + 4, size: 7, font: f.reg, color: MUTED });
    const disc = 'Values are taken from custodian statements and manual entries as of the dates shown. Totals are calculated automatically.';
    p.drawText(disc, { x: M, y: M - 6, size: 6, font: f.ital, color: MUTED });
  });

  return doc.save();
}
