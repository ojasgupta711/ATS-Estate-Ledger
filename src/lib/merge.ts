// Three-way merge used when two people change the same client data at the same time.
// base   = what this browser last loaded or saved
// mine   = this browser's current data
// theirs = what someone else saved to the server since then
// Records are merged one by one (by id). When both people changed the same record,
// their saved version wins and the conflict is reported, so nothing changes silently.
import type { AppData } from '../types';

export interface MergeResult {
  data: AppData;
  conflicts: string[]; // readable names of records both people changed
}

type WithId = { id: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeById<T extends WithId>(base: T[], mine: T[], theirs: T[], label: (x: T) => string, conflicts: string[]): T[] {
  const b = new Map(base.map((x) => [x.id, x]));
  const m = new Map(mine.map((x) => [x.id, x]));
  const t = new Map(theirs.map((x) => [x.id, x]));
  const ids = new Set([...t.keys(), ...m.keys()]);
  const out: T[] = [];
  // Keep their order, then append anything only this browser added.
  const order = [...theirs.map((x) => x.id), ...mine.map((x) => x.id).filter((id) => !t.has(id))];
  for (const id of order) {
    if (!ids.has(id)) continue;
    ids.delete(id);
    const bx = b.get(id);
    const mx = m.get(id);
    const tx = t.get(id);
    const mineChanged = !same(bx, mx);
    const theirsChanged = !same(bx, tx);
    if (!mineChanged) {
      if (tx) out.push(tx);
      continue;
    }
    if (!theirsChanged) {
      if (mx) out.push(mx); // my edit or addition; a deletion simply drops it
      continue;
    }
    // Both sides changed the same record.
    if (same(mx, tx)) {
      if (tx) out.push(tx);
      continue;
    }
    const x = tx ?? mx;
    if (x) conflicts.push(label(x));
    if (tx) out.push(tx);
    else if (mx) out.push(mx); // they deleted it but I edited it: keep my edit rather than lose it
  }
  return out;
}

function mergeList(base: string[], mine: string[], theirs: string[]): string[] {
  const added = mine.filter((x) => !base.includes(x));
  const removed = base.filter((x) => !mine.includes(x));
  return [...theirs.filter((x) => !removed.includes(x)), ...added.filter((x) => !theirs.includes(x))];
}

export function mergeData(base: AppData, mine: AppData, theirs: AppData): MergeResult {
  const conflicts: string[] = [];
  const data: AppData = {
    ...theirs,
    clients: mergeById(base.clients, mine.clients, theirs.clients, (c) => `client ${c.name}`, conflicts),
    nodes: mergeById(base.nodes, mine.nodes, theirs.nodes, (n) => `trust ${n.name}`, conflicts),
    accounts: mergeById(base.accounts, mine.accounts, theirs.accounts, (a) => `account ${a.name}`, conflicts),
    imports: mergeById(base.imports, mine.imports, theirs.imports, (i) => `import ${i.fileName}`, conflicts),
    mappingTemplates: same(base.mappingTemplates, mine.mappingTemplates) ? theirs.mappingTemplates : mine.mappingTemplates,
    accountTypes: mergeList(base.accountTypes, mine.accountTypes, theirs.accountTypes),
    institutions: mergeList(base.institutions, mine.institutions, theirs.institutions),
    settings: same(base.settings, mine.settings) ? theirs.settings : mine.settings,
    // The change log only grows: keep every entry from both sides, newest first.
    activity: [...new Map([...(theirs.activity ?? []), ...(mine.activity ?? [])].map((e) => [e.id, e])).values()].sort((a, b) => b.at.localeCompare(a.at)),
  };
  return { data, conflicts };
}
