import type { Account } from '../types';

// Duplicate detection compares account number, account name, institution and trust.
// It is deliberately conservative: it flags possible matches for a human to decide,
// and never merges anything on its own.

export interface Candidate {
  name: string;
  number: string;
  institution: string;
  parentName?: string;
}

export interface DuplicateMatch {
  account: Account;
  confidence: 'high' | 'medium';
  reasons: string[];
}

const STOP = new Set(['charles', 'inc', 'co', 'corp', 'company', 'the', 'financial', 'group', 'llc', 'na', 'bank', 'and', 'of']);

export function normInstitution(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(' ');
}

export function sameInstitution(a: string, b: string): boolean {
  const x = normInstitution(a);
  const y = normInstitution(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normNumber(s: string): string {
  return s.toUpperCase().replace(/[^0-9A-Z*•X]/g, '');
}

/** "XXXX-4497", "...4497", "****4497" are masked; only trailing digits are known. */
export function isMasked(s: string): boolean {
  return /[xX*•]|\.\.\./.test(s);
}

export function last4(s: string): string {
  const d = s.replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

export function numbersMatch(a: string, b: string): 'exact' | 'last4' | 'differ' | 'unknown' {
  if (!a.trim() || !b.trim()) return 'unknown';
  if (!isMasked(a) && !isMasked(b)) {
    return normNumber(a) === normNumber(b) ? 'exact' : 'differ';
  }
  const la = last4(a);
  const lb = last4(b);
  if (!la || !lb) return 'unknown';
  return la === lb ? 'last4' : 'differ';
}

export function findDuplicates(c: Candidate, existing: Account[], parentNameOf: (a: Account) => string): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const a of existing) {
    const reasons: string[] = [];
    const num = numbersMatch(c.number, a.number);
    const inst = sameInstitution(c.institution, a.institution);
    const name = normName(c.name) !== '' && normName(c.name) === normName(a.name);
    const trust = !!c.parentName && normName(c.parentName) === normName(parentNameOf(a));

    // A clearly different account number rules out a duplicate even if names match
    // (e.g. two "Schwab Doe Family 1998 Trust" accounts).
    if (num === 'differ') continue;

    let confidence: DuplicateMatch['confidence'] | null = null;
    if (num === 'exact') {
      reasons.push('Same account number');
      confidence = 'high';
    } else if (num === 'last4') {
      reasons.push(`Account number ends in ${last4(c.number)}`);
      confidence = inst ? 'high' : 'medium';
    }
    if (inst && (num === 'exact' || num === 'last4')) reasons.push('Same institution');
    if (num === 'unknown' && name && inst) {
      reasons.push('Same account name and institution');
      confidence = 'medium';
    }
    if (confidence && name && !reasons.some((r) => r.includes('name'))) reasons.push('Same account name');
    if (confidence && trust) reasons.push('Same trust');
    if (confidence) out.push({ account: a, confidence, reasons });
  }
  return out.sort((x, y) => (x.confidence === y.confidence ? 0 : x.confidence === 'high' ? -1 : 1));
}
