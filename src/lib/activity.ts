// Builds readable "what changed" lists for the Changes / Import History log.
import type { Account, ActivityChange, ActivityEntry, ActivityKind, Client, EstateNode, ImportRecord } from '../types';
import { fmtDate, maskNumber, money, uid } from './format';

export interface Actor {
  name: string;
  email: string;
}

export function entry(clientId: string, kind: ActivityKind, user: Actor, summary: string, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  return { id: uid('act'), clientId, at: new Date().toISOString(), user, kind, summary, ...extra };
}

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

export function accountLabel(a: Pick<Account, 'name' | 'number'>): string {
  return a.number ? `${a.name} ${maskNumber(a.number)}` : a.name;
}

export function accountChanges(before: Account, after: Account, nodes: EstateNode[]): ActivityChange[] {
  const trust = (id: string | null) => (id ? (nodes.find((n) => n.id === id)?.name ?? 'Deleted trust') : 'Not in a trust');
  const rows: [string, string, string][] = [
    ['Account name', text(before.name), text(after.name)],
    ['Account number', text(before.number), text(after.number)],
    ['Institution', text(before.institution), text(after.institution)],
    ['Account type', text(before.type), text(after.type)],
    ['Parent trust', trust(before.parentId), trust(after.parentId)],
    ['Owner', text(before.owner), text(after.owner)],
    ['Beneficiary', text(before.beneficiary), text(after.beneficiary)],
    ['Current value / FMV', money(before.value, true), money(after.value, true)],
    ['Distribution amount', money(before.distributionAmount, true), money(after.distributionAmount, true)],
    ['Distribution frequency', text(before.distributionFrequency), text(after.distributionFrequency)],
    ['Value as of', fmtDate(before.lastUpdated), fmtDate(after.lastUpdated)],
    ['Notes', text(before.notes), text(after.notes)],
    ['Excluded from total', yesNo(before.excludeFromTotal), yesNo(after.excludeFromTotal)],
  ];
  return rows.filter(([, b, a]) => b !== a).map(([field, b, a]) => ({ field, before: b, after: a }));
}

export function nodeChanges(before: EstateNode, after: EstateNode, nodes: EstateNode[]): ActivityChange[] {
  const parent = (id: string | null) => (id ? (nodes.find((n) => n.id === id)?.name ?? 'Deleted trust') : 'Top level');
  const col = { auto: 'Automatic', left: 'Left', right: 'Right' };
  const rows: [string, string, string][] = [
    ['Name', text(before.name), text(after.name)],
    ['Type', text(before.type), text(after.type)],
    ['Parent trust', parent(before.parentId), parent(after.parentId)],
    ['Header color', text(before.color), text(after.color)],
    ['PDF column', col[before.reportColumn], col[after.reportColumn]],
    ['Excluded from total', yesNo(before.excludeFromTotal), yesNo(after.excludeFromTotal)],
    ['Distribution information', text(before.distributionInfo), text(after.distributionInfo)],
    ['Notes', text(before.notes), text(after.notes)],
  ];
  const out = rows.filter(([, b, a]) => b !== a).map(([field, b, a]) => ({ field, before: b, after: a }));
  if (JSON.stringify(before.crt ?? null) !== JSON.stringify(after.crt ?? null)) {
    out.push({ field: 'CRT payout schedule', before: before.crt ? `${before.crt.rows.length} years` : '—', after: after.crt ? `${after.crt.rows.length} years (updated)` : '—' });
  }
  return out;
}

export function clientChanges(before: Client, after: Client): ActivityChange[] {
  const rows: [string, string, string][] = [
    ['Client name', text(before.name), text(after.name)],
    ['Estate name', text(before.estateName), text(after.estateName)],
    ['Notes', text(before.notes), text(after.notes)],
  ];
  return rows.filter(([, b, a]) => b !== a).map(([field, b, a]) => ({ field, before: b, after: a }));
}

/** History for data saved before the change log existed: one entry per import. */
export function activityFromImports(imports: ImportRecord[]): ActivityEntry[] {
  return imports.map((i) => ({
    id: `act_${i.id}`,
    clientId: i.clientId,
    at: i.importedAt,
    user: { name: i.importedBy, email: i.importedBy },
    kind: 'import' as const,
    summary: `Imported ${i.fileName}: ${i.accountsAdded} added, ${i.accountsReplaced} updated, ${i.accountsSkipped} kept (${money(i.totalValue)})`,
    importId: i.id,
  }));
}

export const KIND_LABEL: Record<ActivityKind, string> = {
  'client-added': 'Client created',
  'client-updated': 'Client updated',
  'account-added': 'Account added',
  'account-updated': 'Account updated',
  'account-deleted': 'Account deleted',
  'trust-added': 'Trust added',
  'trust-updated': 'Trust updated',
  'trust-deleted': 'Trust deleted',
  import: 'Excel import',
  report: 'PDF generated',
};

export type KindGroup = 'imports' | 'accounts' | 'trusts' | 'other';
export function kindGroup(k: ActivityKind): KindGroup {
  if (k === 'import') return 'imports';
  if (k.startsWith('account')) return 'accounts';
  if (k.startsWith('trust')) return 'trusts';
  return 'other';
}

/** A few words for compact lists, e.g. "Updated Schwab IRA ••••4497" or "Imported Schwab September 2026.xlsx". */
export function briefSummary(e: ActivityEntry): string {
  if (e.kind === 'import') return e.summary.replace(/:.*$/, '');
  if (e.kind === 'report') return 'Generated estate summary PDF';
  return e.summary.split(' — ')[0].replace(/ \((?:Trust|Category|Qualified|Minor|CRT|Family Trust|Children's Trust|Sub-Trust|Other)\)/, '');
}
