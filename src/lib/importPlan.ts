// Pure logic for turning spreadsheet rows into reviewed import rows.
import type { AccountDraft } from '../state/store';
import type { Account, EstateNode } from '../types';
import { matchInstitution } from '../data/institutions';
import { findDuplicates, normName, numbersMatch, sameInstitution, type DuplicateMatch } from './duplicates';
import { todayIso } from './format';
import { isTotalRow, matchAccountType, parseDate, parseFrequency, parseMoney, type Mapping } from './mapping';

export type Resolution = 'keep' | 'replace' | 'new';

export interface RowOverride {
  include?: boolean;
  type?: string;
  parentId?: string | null;
  institution?: string;
  resolution?: Resolution;
  targetId?: string;
  value?: string; // corrected value typed during review
}

export type InstitutionSource = 'row' | 'column' | 'section' | 'sheet' | 'default' | 'none';

export interface PlannedRow {
  key: string; // unique across sheets: "<sheet>!<row>"
  sheet: string;
  rowNumber: number; // 1-based row in the spreadsheet
  raw: string[];
  data: AccountDraft;
  rawType: string;
  rawValue: string;
  rawInstitution: string;
  institutionSource: InstitutionSource;
  errors: string[];
  warnings: string[];
  duplicates: DuplicateMatch[];
  inFileDuplicateOf?: string;
  include: boolean;
  resolution: Resolution | null; // null = duplicate not yet resolved
  targetId?: string;
}

export interface PlanSheet {
  name: string;
  rows: string[][];
  headerIndex: number;
}

export interface PlanInput {
  sheets: PlanSheet[];
  mapping: Mapping;
  institution: string; // default when a row doesn't name one
  institutions: string[]; // the user's institution list, for matching
  typeMap: Record<string, string>; // raw spreadsheet type -> app type
  defaultType: string;
  defaultParentId: string | null;
  overrides: Record<string, RowOverride>;
  existing: Account[];
  nodes: EstateNode[];
}

export function distinctRawTypes(sheets: PlanSheet[], mapping: Mapping): string[] {
  if (mapping.type === undefined) return [];
  const set = new Set<string>();
  for (const sh of sheets)
    for (const r of sh.rows.slice(sh.headerIndex + 1)) {
      if (isTotalRow(r)) continue;
      const v = (r[mapping.type] ?? '').trim();
      if (v) set.add(v);
    }
  return [...set];
}

export function suggestTypeMap(raws: string[], types: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of raws) out[r] = matchAccountType(r, types) ?? '';
  return out;
}

/** A row whose only content is an institution name, e.g. "Pacific Life" above that carrier's contracts. */
export function sectionHeading(r: string[], mapping: Mapping, institutions: string[]): string | null {
  const filled = r.map((c) => c.trim()).filter(Boolean);
  if (filled.length !== 1) return null;
  if (mapping.value !== undefined && (r[mapping.value] ?? '').trim()) return null;
  return matchInstitution(filled[0].replace(/^(carrier|custodian|institution|company)\s*:\s*/i, ''), institutions);
}

export function buildPlan(p: PlanInput): PlannedRow[] {
  const cell = (r: string[], k: keyof Mapping) => {
    const i = p.mapping[k];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const nodeByName = new Map(p.nodes.map((n) => [normName(n.name), n]));
  const parentName = (a: Account) => p.nodes.find((n) => n.id === a.parentId)?.name ?? '';
  const multiSheet = p.sheets.length > 1;
  const out: PlannedRow[] = [];

  for (const sh of p.sheets) {
    const sheetInstitution = /^sheet\s*\d*$/i.test(sh.name.trim()) ? null : matchInstitution(sh.name, p.institutions);
    let section: string | null = null;

    sh.rows.forEach((r, idx) => {
      if (idx <= sh.headerIndex) return;
      if (r.every((c) => !c.trim())) return;
      if (isTotalRow(r)) return;
      const heading = sectionHeading(r, p.mapping, p.institutions);
      if (heading) {
        section = heading;
        return;
      }
      const rowNumber = idx + 1;
      const key = `${sh.name}!${rowNumber}`;
      const o = p.overrides[key] ?? {};
      const errors: string[] = [];
      const warnings: string[] = [];

      const name = cell(r, 'name');
      const number = cell(r, 'number');
      const rawValue = o.value ?? cell(r, 'value');
      const money = parseMoney(rawValue);
      const dist = parseMoney(cell(r, 'distributionAmount'));
      const freq = parseFrequency(cell(r, 'distributionFrequency'));
      const date = parseDate(cell(r, 'lastUpdated'));
      const rawType = cell(r, 'type');
      const rawParent = cell(r, 'parent');
      const rawInstitution = cell(r, 'institution');

      // Institution: a choice made in review, then the row's own column, a section heading,
      // the sheet name, and finally the default picked for the file.
      let institution = '';
      let institutionSource: InstitutionSource = 'none';
      if (o.institution) {
        institution = o.institution;
        institutionSource = 'row';
      } else if (rawInstitution) {
        const m = matchInstitution(rawInstitution, p.institutions);
        institution = m ?? rawInstitution;
        institutionSource = 'column';
        if (!m) warnings.push(`Institution “${rawInstitution}” is not in your list`);
      } else if (section) {
        institution = section;
        institutionSource = 'section';
      } else if (sheetInstitution) {
        institution = sheetInstitution;
        institutionSource = 'sheet';
      } else if (p.institution) {
        institution = p.institution;
        institutionSource = 'default';
      }
      if (!institution) errors.push('No institution — choose one for this row or a default for the file');

      if (!name && !number) errors.push('No account name or number');
      if (!rawValue) errors.push('Missing value');
      else if (!money.ok) errors.push(`Value “${rawValue}” is not a number`);
      else if ((money.value ?? 0) < 0) errors.push('Value is negative');
      if (!dist.ok) warnings.push(`Distribution “${cell(r, 'distributionAmount')}” ignored`);
      if (!freq.ok) warnings.push(`Frequency “${cell(r, 'distributionFrequency')}” not recognized`);
      if (dist.value && !freq.value) warnings.push('Distribution has no frequency');
      if (!date.ok) warnings.push(`Date “${cell(r, 'lastUpdated')}” not recognized — using today`);
      if (!number) warnings.push('No account number');

      let type = o.type ?? (rawType ? p.typeMap[rawType] : '') ?? '';
      if (!type) {
        type = p.defaultType;
        if (rawType && o.type === undefined) warnings.push(`Type “${rawType}” → ${p.defaultType || 'none'}`);
      }
      if (!type) errors.push('No account type');

      let parentId: string | null = p.defaultParentId;
      if (rawParent) {
        const match = nodeByName.get(normName(rawParent));
        if (match) parentId = match.id;
        else warnings.push(`Trust “${rawParent}” not found — using default`);
      }
      if (o.parentId !== undefined) parentId = o.parentId;

      const data: AccountDraft = {
        name: name || `${institution} ${number}`.trim(),
        number,
        institution,
        type,
        parentId,
        owner: cell(r, 'owner'),
        beneficiary: cell(r, 'beneficiary'),
        value: money.ok ? money.value : null,
        distributionAmount: dist.ok ? dist.value : null,
        distributionFrequency: freq.value,
        lastUpdated: date.value || todayIso(),
        notes: cell(r, 'notes'),
        excludeFromTotal: false,
      };

      const duplicates = findDuplicates({ name: data.name, number, institution, parentName: p.nodes.find((n) => n.id === parentId)?.name }, p.existing, parentName);

      let resolution: Resolution | null = o.resolution ?? (duplicates.length ? null : 'new');
      const targetId = o.targetId ?? duplicates[0]?.account.id;
      if (resolution === 'replace' && !targetId) resolution = null;

      out.push({
        key,
        sheet: sh.name,
        rowNumber,
        raw: r,
        data,
        rawType,
        rawValue,
        rawInstitution,
        institutionSource,
        errors,
        warnings,
        duplicates,
        include: errors.length === 0 && (o.include ?? true),
        resolution,
        targetId,
      });
    });
  }

  // Same account appearing twice in one file (same institution and number, or same name when there is no number).
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = out[i].data;
      const b = out[j].data;
      if (!sameInstitution(a.institution, b.institution)) continue;
      const num = numbersMatch(a.number, b.number);
      if (num === 'exact' || num === 'last4' || (num === 'unknown' && normName(a.name) === normName(b.name))) {
        out[i].inFileDuplicateOf = out[j].key;
        out[i].warnings.push(`Same account as ${multiSheet ? `${out[j].sheet} ` : ''}row ${out[j].rowNumber} in this file`);
        break;
      }
    }
  }
  return out;
}

/** Institutions found in the plan, with counts and values, largest first. */
export function institutionBreakdown(rows: PlannedRow[]): { institution: string; count: number; value: number }[] {
  const m = new Map<string, { institution: string; count: number; value: number }>();
  for (const r of rows) {
    const k = r.data.institution || '(none)';
    const b = m.get(k) ?? { institution: k, count: 0, value: 0 };
    b.count++;
    b.value = Math.round((b.value + (r.data.value ?? 0)) * 100) / 100;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

export interface PlanSummary {
  included: PlannedRow[];
  toAdd: PlannedRow[];
  toReplace: PlannedRow[];
  toKeep: PlannedRow[];
  unresolved: PlannedRow[];
  errorRows: PlannedRow[];
  importValue: number;
}

export function summarizePlan(rows: PlannedRow[]): PlanSummary {
  const included = rows.filter((r) => r.include);
  const unresolved = included.filter((r) => r.resolution === null);
  const toAdd = included.filter((r) => r.resolution === 'new');
  const toReplace = included.filter((r) => r.resolution === 'replace');
  const toKeep = included.filter((r) => r.resolution === 'keep');
  const importValue = Math.round([...toAdd, ...toReplace].reduce((s, r) => s + (r.data.value ?? 0), 0) * 100) / 100;
  return { included, toAdd, toReplace, toKeep, unresolved, errorRows: rows.filter((r) => r.errors.length), importValue };
}

/** Fields that differ between an existing account and an imported row. */
export function diffFields(existing: Account, incoming: AccountDraft): { field: string; before: string; after: string; changes: boolean }[] {
  const f = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
  const money = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  const rows = [
    { field: 'Account name', before: f(existing.name), after: f(incoming.name), changes: false },
    { field: 'Account number', before: f(existing.number), after: f(incoming.number), changes: false },
    { field: 'Institution', before: f(existing.institution), after: f(incoming.institution), changes: false },
    { field: 'Owner', before: f(existing.owner), after: f(incoming.owner), changes: !!incoming.owner },
    { field: 'Beneficiary', before: f(existing.beneficiary), after: f(incoming.beneficiary), changes: !!incoming.beneficiary },
    { field: 'Current value / FMV', before: money(existing.value), after: money(incoming.value), changes: true },
    { field: 'Distribution amount', before: money(existing.distributionAmount), after: money(incoming.distributionAmount), changes: incoming.distributionAmount !== null },
    { field: 'Distribution frequency', before: f(existing.distributionFrequency), after: f(incoming.distributionFrequency), changes: !!incoming.distributionFrequency },
    { field: 'Value as of', before: f(existing.lastUpdated), after: f(incoming.lastUpdated), changes: true },
  ];
  return rows.map((r) => ({ ...r, changes: r.changes && r.before !== r.after }));
}
