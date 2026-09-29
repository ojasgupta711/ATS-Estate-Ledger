import type { Account, EstateNode, Frequency } from '../types';

// All totals are derived from account values on every render —
// nothing is stored, so totals can never drift from the underlying accounts.

export interface EstateScope {
  nodes: EstateNode[];
  accounts: Account[];
}

export const FREQ_FACTOR: Record<string, number> = {
  Monthly: 12,
  Quarterly: 4,
  'Semi-Annual': 2,
  Annual: 1,
  'One-Time': 1,
  'As Needed': 1,
};

export function annualized(amount: number | null, freq: Frequency): number {
  if (!amount) return 0;
  return amount * (FREQ_FACTOR[freq] ?? 1);
}

const val = (a: Account) => (typeof a.value === 'number' && Number.isFinite(a.value) ? a.value : 0);

/** Round to cents to avoid floating-point noise when summing. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function sortNodes(nodes: EstateNode[]): EstateNode[] {
  return [...nodes].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function childNodes(scope: EstateScope, parentId: string | null): EstateNode[] {
  return sortNodes(scope.nodes.filter((n) => n.parentId === parentId));
}

export function childAccounts(scope: EstateScope, parentId: string | null): Account[] {
  return scope.accounts
    .filter((a) => a.parentId === parentId)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.name.localeCompare(b.name));
}

/** Ancestor chain from the root down to (and including) the given node. */
export function nodePath(nodes: EstateNode[], nodeId: string | null): EstateNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: EstateNode[] = [];
  let cur = nodeId ? byId.get(nodeId) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return path;
}

/** The node plus every node beneath it. */
export function descendantIds(nodes: EstateNode[], nodeId: string): Set<string> {
  const out = new Set<string>([nodeId]);
  let added = true;
  while (added) {
    added = false;
    for (const n of nodes) {
      if (n.parentId && out.has(n.parentId) && !out.has(n.id)) {
        out.add(n.id);
        added = true;
      }
    }
  }
  return out;
}

/** Children's Trusts are always shown for reference and never counted in the estate total. */
export const ALWAYS_EXCLUDED_TYPE = "Children's Trust";

/** True when this trust itself is left out of the estate total (by its setting or its type). */
export function nodeSelfExcluded(n: Pick<EstateNode, 'excludeFromTotal' | 'type'>): boolean {
  return n.excludeFromTotal || n.type === ALWAYS_EXCLUDED_TYPE;
}

export function isNodeExcluded(nodes: EstateNode[], nodeId: string | null): boolean {
  return nodePath(nodes, nodeId).some(nodeSelfExcluded);
}

export function accountSelfExcluded(a: Pick<Account, 'excludeFromTotal' | 'type'>): boolean {
  return a.excludeFromTotal || a.type === ALWAYS_EXCLUDED_TYPE;
}

export function isAccountExcluded(nodes: EstateNode[], a: Account): boolean {
  return accountSelfExcluded(a) || isNodeExcluded(nodes, a.parentId);
}

/** Accounts whose trust no longer exists are treated as not assigned, so they are never lost from a report. */
export function normalizeScope<T extends EstateScope>(scope: T): T {
  const ids = new Set(scope.nodes.map((n) => n.id));
  if (scope.accounts.every((a) => a.parentId === null || ids.has(a.parentId))) return scope;
  return { ...scope, accounts: scope.accounts.map((a) => (a.parentId && !ids.has(a.parentId) ? { ...a, parentId: null } : a)) };
}

export interface NodeTotals {
  direct: number; // accounts directly in this node
  rollup: number; // direct + all child trusts
  rollupIncluded: number; // rollup, minus anything excluded from the estate total
  display: number; // what to show next to the trust: counted value, or full value if the trust itself is excluded
  accountCount: number; // accounts in the whole subtree
  directCount: number;
  distributionsAnnual: number;
}

export function nodeTotals(scope: EstateScope, nodeId: string): NodeTotals {
  const ids = descendantIds(scope.nodes, nodeId);
  const direct = scope.accounts.filter((a) => a.parentId === nodeId);
  const all = scope.accounts.filter((a) => a.parentId && ids.has(a.parentId));
  const rollup = round2(all.reduce((s, a) => s + val(a), 0));
  const rollupIncluded = round2(all.filter((a) => !isAccountExcluded(scope.nodes, a)).reduce((s, a) => s + val(a), 0));
  return {
    direct: round2(direct.reduce((s, a) => s + val(a), 0)),
    rollup,
    rollupIncluded,
    display: isNodeExcluded(scope.nodes, nodeId) ? rollup : rollupIncluded,
    accountCount: all.length,
    directCount: direct.length,
    distributionsAnnual: round2(all.reduce((s, a) => s + annualized(a.distributionAmount, a.distributionFrequency), 0)),
  };
}

export interface Bucket {
  key: string;
  value: number;
  count: number;
}

function bucket(accounts: Account[], keyOf: (a: Account) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const a of accounts) {
    const k = keyOf(a) || 'Unspecified';
    const b = m.get(k) ?? { key: k, value: 0, count: 0 };
    b.value = round2(b.value + val(a));
    b.count += 1;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export interface EstateSummary {
  total: number; // estate total (excludes flagged accounts)
  accountCount: number; // every account on file
  includedCount: number;
  excludedTotal: number;
  excludedCount: number;
  byType: Bucket[];
  byInstitution: Bucket[];
  byTopNode: { node: EstateNode | null; value: number; count: number; excluded: boolean }[];
  distributionsAnnual: number;
  unassignedValue: number;
  unassignedCount: number;
  lastUpdated: string | null;
}

export function estateSummary(scope: EstateScope, accountTypes: string[]): EstateSummary {
  const included = scope.accounts.filter((a) => !isAccountExcluded(scope.nodes, a));
  const excluded = scope.accounts.filter((a) => isAccountExcluded(scope.nodes, a));

  const byTypeRaw = bucket(included, (a) => a.type);
  // Always show every configured account type (with $0) so the breakdown is complete.
  const byType = [
    ...accountTypes.map((t) => byTypeRaw.find((b) => b.key === t) ?? { key: t, value: 0, count: 0 }),
    ...byTypeRaw.filter((b) => !accountTypes.includes(b.key)),
  ];

  const tops = childNodes(scope, null);
  const byTopNode: EstateSummary['byTopNode'] = tops.map((n) => {
    const t = nodeTotals(scope, n.id);
    return { node: n, value: nodeSelfExcluded(n) ? t.rollup : t.rollupIncluded, count: t.accountCount, excluded: nodeSelfExcluded(n) };
  });
  const unassigned = scope.accounts.filter((a) => a.parentId === null);
  if (unassigned.length) {
    byTopNode.push({ node: null, value: round2(unassigned.reduce((s, a) => s + val(a), 0)), count: unassigned.length, excluded: false });
  }

  const dates = scope.accounts.map((a) => a.lastUpdated).filter(Boolean).sort();

  return {
    total: round2(included.reduce((s, a) => s + val(a), 0)),
    accountCount: scope.accounts.length,
    includedCount: included.length,
    excludedTotal: round2(excluded.reduce((s, a) => s + val(a), 0)),
    excludedCount: excluded.length,
    byType,
    byInstitution: bucket(included, (a) => a.institution),
    byTopNode,
    distributionsAnnual: round2(included.reduce((s, a) => s + annualized(a.distributionAmount, a.distributionFrequency), 0)),
    unassignedValue: round2(unassigned.reduce((s, a) => s + val(a), 0)),
    unassignedCount: unassigned.length,
    lastUpdated: dates.length ? dates[dates.length - 1] : null,
  };
}

/** Running totals for a CRT payout schedule. */
export function crtRunningTotals(rows: { distribution: number | null }[]): number[] {
  let run = 0;
  return rows.map((r) => (run = round2(run + (r.distribution ?? 0))));
}
