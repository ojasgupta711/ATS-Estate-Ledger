import type { Frequency, ImportField } from '../types';
import { excelSerialToIso } from './spreadsheet';

export interface FieldDef {
  key: ImportField;
  label: string;
  hint?: string;
  synonyms: string[];
}

export const IMPORT_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Account Name', synonyms: ['account name', 'name', 'account', 'account description', 'description', 'registration', 'account title', 'title', 'product', 'product name', 'contract name', 'plan name'] },
  { key: 'number', label: 'Account Number', synonyms: ['account number', 'account #', 'account no', 'acct', 'acct #', 'acct no', 'acct number', 'number', 'contract number', 'contract #', 'contract no', 'policy number', 'policy #', 'account id'] },
  { key: 'institution', label: 'Financial Institution', hint: 'Map this when the file lists several institutions. Otherwise the file’s default institution is used.', synonyms: ['institution', 'financial institution', 'institution name', 'custodian', 'custodian name', 'carrier', 'carrier name', 'insurance company', 'insurance carrier', 'company', 'company name', 'issuer', 'product sponsor', 'sponsor', 'provider', 'provider name', 'firm'] },
  { key: 'type', label: 'Account Type', hint: 'Leave unmapped to use the category chosen in step 4', synonyms: ['account type', 'type', 'registration type', 'plan type', 'product type', 'category'] },
  { key: 'owner', label: 'Owner', synonyms: ['owner', 'account owner', 'contract owner', 'registered owner', 'primary owner', 'owner name', 'account holder', 'holder'] },
  { key: 'beneficiary', label: 'Beneficiary', synonyms: ['beneficiary', 'beneficiaries', 'primary beneficiary', 'beneficiary name'] },
  { key: 'parent', label: 'Parent Trust', hint: 'Matched by name to an existing trust', synonyms: ['trust', 'parent trust', 'trust name', 'parent', 'parent account'] },
  { key: 'value', label: 'Current Value / FMV', synonyms: ['market value', 'current value', 'fmv', 'fair market value', 'value', 'balance', 'account value', 'contract value', 'total value', 'ending value', 'ending balance', 'current balance', 'account total', 'cash value', 'total market value'] },
  { key: 'distributionAmount', label: 'Distribution Amount', synonyms: ['distribution amount', 'distribution', 'distributions', 'payout amount', 'payment amount', 'withdrawal amount', 'rmd', 'rmd amount', 'income amount'] },
  { key: 'distributionFrequency', label: 'Distribution Frequency', synonyms: ['frequency', 'distribution frequency', 'payout mode', 'payout frequency', 'payment frequency', 'mode'] },
  { key: 'lastUpdated', label: 'Last Updated / As-of Date', hint: 'Leave unmapped to use the import date', synonyms: ['as of', 'as of date', 'as-of date', 'valuation date', 'value date', 'statement date', 'last updated', 'date', 'price date', 'market value date'] },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'comments', 'comment', 'memo', 'remarks'] },
];

export type Mapping = Partial<Record<ImportField, number>>; // field -> column index

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

/** Suggests a column for each field based on common header names from custodians. */
export function suggestMapping(headers: string[]): Mapping {
  const scores: { field: ImportField; col: number; score: number }[] = [];
  headers.forEach((h, col) => {
    const nh = norm(h);
    if (!nh) return;
    for (const f of IMPORT_FIELDS) {
      let best = 0;
      f.synonyms.forEach((syn, rank) => {
        const ns = norm(syn);
        let s = 0;
        if (nh === ns) s = 100 - rank;
        else if (new RegExp(`(^| )${ns.replace(/[#]/g, '\\#')}( |$)`).test(nh)) s = 50 - rank;
        if (s > best) best = s;
      });
      if (best > 0) scores.push({ field: f.key, col, score: best });
    }
  });
  scores.sort((a, b) => b.score - a.score);
  const mapping: Mapping = {};
  const usedCols = new Set<number>();
  for (const s of scores) {
    if (mapping[s.field] !== undefined || usedCols.has(s.col)) continue;
    mapping[s.field] = s.col;
    usedCols.add(s.col);
  }
  return mapping;
}

export interface ParsedMoney {
  value: number | null;
  ok: boolean; // false = present but could not be read as a number
}

export function parseMoney(raw: string | undefined): ParsedMoney {
  const s = (raw ?? '').trim();
  if (!s) return { value: null, ok: true };
  // Excel accounting format shows zero as "-" or "$ -".
  if (/^\$?\s*-{1,2}\s*$/.test(s)) return { value: 0, ok: true };
  let t = s.replace(/[$,\s]/g, '').replace(/USD$/i, '');
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith('-')) {
    neg = true;
    t = t.slice(0, -1);
  }
  if (!/^-?\d*\.?\d+$/.test(t)) return { value: null, ok: false };
  const n = Number(t);
  if (!Number.isFinite(n)) return { value: null, ok: false };
  return { value: Math.round((neg ? -n : n) * 100) / 100, ok: true };
}

export function parseFrequency(raw: string | undefined): { value: Frequency; ok: boolean } {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return { value: '', ok: true };
  if (/^(monthly|month|mo|m|mthly)$/.test(s)) return { value: 'Monthly', ok: true };
  if (/^(quarterly|quarter|qtr|qtrly|q)$/.test(s)) return { value: 'Quarterly', ok: true };
  if (/^(semi[- ]?annual(ly)?|semiannual|sa|biannual)$/.test(s)) return { value: 'Semi-Annual', ok: true };
  if (/^(annual(ly)?|yearly|year|a|y|yr)$/.test(s)) return { value: 'Annual', ok: true };
  if (/^(one[- ]?time|once|lump sum|single)$/.test(s)) return { value: 'One-Time', ok: true };
  if (/^(as needed|ad hoc|on request)$/.test(s)) return { value: 'As Needed', ok: true };
  return { value: '', ok: false };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseDate(raw: string | undefined): { value: string; ok: boolean } {
  const s = (raw ?? '').trim();
  if (!s) return { value: '', ok: true };
  const pad = (n: number) => String(n).padStart(2, '0');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { value: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, ok: true };
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return { value: `${y}-${pad(+m[1])}-${pad(+m[2])}`, ok: true };
  }
  m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) {
    return { value: `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(+m[2])}`, ok: true };
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return { value: excelSerialToIso(Number(s)), ok: true };
  return { value: '', ok: false };
}

const TYPE_SYNONYMS: [RegExp, string][] = [
  [/children'?s trust/i, "Children's Trust"],
  [/family trust/i, 'Family Trust'],
  [/sub-?trust/i, 'Sub-Trust'],
  [/\bcrt\b|charitable remainder/i, 'CRT'],
  [/\b(ira|roth|sep|simple|401\s?\(?k\)?|403\s?\(?b\)?|457|qualified|rollover|inherited)\b/i, 'Qualified'],
  [/\b(utma|ugma|custodial|minor|529)\b/i, 'Minor'],
  [/\b(joint|jtwros|jt ten|tenants)\b/i, 'Joint'],
  [/\bindividual\b/i, 'Individual'],
  [/\btrust\b/i, 'Trust'],
];

/** Maps a custodian's account-type text onto the app's account types. */
export function matchAccountType(raw: string | undefined, types: string[]): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const exact = types.find((t) => t.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  for (const [re, t] of TYPE_SYNONYMS) if (re.test(s) && types.includes(t)) return t;
  return null;
}

/** Rows like "Account Total" or "Grand Total" should not become accounts. */
export function isTotalRow(cells: string[]): boolean {
  const text = cells.filter((c) => c && !/^[-$()\d.,%\s]+$/.test(c));
  return text.length > 0 && text.length <= 2 && text.some((c) => /\b(grand\s+)?totals?\b/i.test(c));
}
