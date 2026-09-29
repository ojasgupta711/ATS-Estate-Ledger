import type { Account, EstateNode, ImportRecord } from '../types';
import { findDuplicates } from './duplicates';
import { daysSince, fmtDate } from './format';

export type Severity = 'error' | 'warning' | 'info';

export interface QualityIssue {
  id: string;
  severity: Severity;
  kind:
    | 'duplicate'
    | 'missing-value'
    | 'invalid-value'
    | 'missing-type'
    | 'unknown-type'
    | 'missing-trust'
    | 'broken-trust'
    | 'missing-number'
    | 'missing-institution'
    | 'stale'
    | 'unmapped-columns'
    | 'empty-trust';
  title: string;
  detail: string;
  accountId?: string;
  nodeId?: string;
  importId?: string;
}

export const STALE_DAYS = 90;

export function qualityIssues(
  accounts: Account[],
  nodes: EstateNode[],
  imports: ImportRecord[],
  accountTypes: string[],
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeName = (a: Account) => nodes.find((n) => n.id === a.parentId)?.name ?? '';
  const label = (a: Account) => `${a.name || 'Unnamed account'}${a.number ? ` (${a.number.slice(-4)})` : ''}`;

  const seenPairs = new Set<string>();
  accounts.forEach((a, i) => {
    const others = accounts.slice(i + 1);
    for (const m of findDuplicates(a, others, nodeName)) {
      const key = [a.id, m.account.id].sort().join('|');
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      issues.push({
        id: `dup:${key}`,
        severity: 'warning',
        kind: 'duplicate',
        title: 'Possible duplicate account',
        detail: `${label(a)} and ${label(m.account)} — ${m.reasons.join(', ').toLowerCase()}.`,
        accountId: a.id,
      });
    }

    if (a.value === null) {
      issues.push({ id: `val:${a.id}`, severity: 'error', kind: 'missing-value', title: 'Missing account value', detail: `${label(a)} has no current market value.`, accountId: a.id });
    } else if (!Number.isFinite(a.value) || a.value < 0) {
      issues.push({ id: `inv:${a.id}`, severity: 'error', kind: 'invalid-value', title: 'Invalid account value', detail: `${label(a)} has a value of ${a.value}.`, accountId: a.id });
    }
    if (a.distributionAmount !== null && a.distributionAmount < 0) {
      issues.push({ id: `dist:${a.id}`, severity: 'error', kind: 'invalid-value', title: 'Invalid distribution amount', detail: `${label(a)} has a negative distribution.`, accountId: a.id });
    }
    if (a.distributionAmount && !a.distributionFrequency) {
      issues.push({ id: `freq:${a.id}`, severity: 'warning', kind: 'invalid-value', title: 'Distribution frequency missing', detail: `${label(a)} has a distribution amount but no frequency.`, accountId: a.id });
    }
    if (!a.type) {
      issues.push({ id: `type:${a.id}`, severity: 'warning', kind: 'missing-type', title: 'Missing account type', detail: `${label(a)} has no account type.`, accountId: a.id });
    } else if (!accountTypes.includes(a.type)) {
      issues.push({ id: `utype:${a.id}`, severity: 'warning', kind: 'unknown-type', title: 'Unrecognized account type', detail: `${label(a)} uses "${a.type}", which is not in your account type list.`, accountId: a.id });
    }
    if (a.parentId === null) {
      issues.push({ id: `trust:${a.id}`, severity: 'warning', kind: 'missing-trust', title: 'Not assigned to a trust or category', detail: `${label(a)} sits directly under the estate. Assign it to a trust or category.`, accountId: a.id });
    } else if (!nodeIds.has(a.parentId)) {
      issues.push({ id: `btrust:${a.id}`, severity: 'error', kind: 'broken-trust', title: 'Trust no longer exists', detail: `${label(a)} points to a trust that was deleted.`, accountId: a.id });
    }
    if (!a.institution.trim()) {
      issues.push({ id: `inst:${a.id}`, severity: 'warning', kind: 'missing-institution', title: 'Missing institution', detail: `${label(a)} has no financial institution.`, accountId: a.id });
    }
    if (!a.number.trim()) {
      issues.push({ id: `num:${a.id}`, severity: 'info', kind: 'missing-number', title: 'No account number', detail: `${label(a)} has no account number, so duplicates can only be matched by name.`, accountId: a.id });
    }
    if (a.lastUpdated && daysSince(a.lastUpdated) > STALE_DAYS) {
      issues.push({ id: `stale:${a.id}`, severity: 'info', kind: 'stale', title: 'Value may be out of date', detail: `${label(a)} was last updated ${fmtDate(a.lastUpdated)} (over ${STALE_DAYS} days ago).`, accountId: a.id });
    }
  });

  for (const n of nodes) {
    if (n.parentId && !nodeIds.has(n.parentId)) {
      issues.push({ id: `bnode:${n.id}`, severity: 'error', kind: 'broken-trust', title: 'Parent trust missing', detail: `${n.name} points to a parent trust that no longer exists.`, nodeId: n.id });
    }
    const hasContent = accounts.some((a) => a.parentId === n.id) || nodes.some((c) => c.parentId === n.id);
    if (!hasContent) {
      issues.push({ id: `empty:${n.id}`, severity: 'info', kind: 'empty-trust', title: 'Trust has no accounts', detail: `${n.name} has no accounts yet, so it shows $0.`, nodeId: n.id });
    }
  }

  for (const imp of imports) {
    if (imp.unmappedColumns.length) {
      issues.push({
        id: `unmapped:${imp.id}`,
        severity: 'info',
        kind: 'unmapped-columns',
        title: 'Unmapped spreadsheet columns',
        detail: `${imp.fileName}: ${imp.unmappedColumns.map((c) => `"${c}"`).join(', ')} ${imp.unmappedColumns.length === 1 ? 'was' : 'were'} not imported.`,
        importId: imp.id,
      });
    }
  }

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
