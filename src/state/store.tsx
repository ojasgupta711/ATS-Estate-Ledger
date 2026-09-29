import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createSeedData, migrateData } from '../data/seed';
import { getRevision, loadServerData, revisionOf, saveServerData, type BackendMode } from '../lib/api';
import { mergeData } from '../lib/merge';
import { accountChanges, accountLabel, clientChanges, entry, nodeChanges, type Actor } from '../lib/activity';
import { useAuth } from './auth';
import { descendantIds, normalizeScope } from '../lib/calc';
import { money, todayIso, uid } from '../lib/format';
import { load, save } from '../lib/storage';
import type { Account, ActivityEntry, AppData, Client, EstateNode, ImportRecord, MappingTemplate, ReportSettings, StoredFile } from '../types';

const KEY = 'ats.data';

export interface Backend {
  mode: BackendMode;
  storage?: string; // folder on disk when the server is running
}

export interface SyncNotice {
  tone: 'info' | 'warning';
  text: string;
}

export type SaveStatus = { state: 'idle' | 'saving' | 'saved' | 'error'; at?: string; error?: string };

function initial(backend: Backend, serverData: unknown): { data: AppData; pushToServer: boolean } {
  if (backend.mode === 'server') {
    const fromServer = migrateData(serverData);
    if (fromServer) return { data: fromServer, pushToServer: fromServer !== serverData };
    // First run with the server: carry over anything tested in this browser, else start from the sample data.
    return { data: migrateData(load<unknown>(KEY, null)) ?? createSeedData(), pushToServer: true };
  }
  return { data: migrateData(load<unknown>(KEY, null)) ?? createSeedData(), pushToServer: false };
}

export type AccountDraft = Omit<Account, 'id' | 'clientId' | 'history' | 'createdAt' | 'source'> & { source?: Account['source'] };

export interface ImportRowCommit {
  rowNumber: number;
  sheet?: string;
  data: AccountDraft;
  action: 'add' | 'replace' | 'keep';
  targetId?: string;
}

export interface ImportCommit {
  clientId: string;
  fileName: string;
  institution: string;
  institutions: string[];
  sheet: string;
  sheets: string[];
  unmappedColumns: string[];
  importedBy: string;
  rows: ImportRowCommit[];
  storedFile?: StoredFile;
}

interface StoreCtx {
  data: AppData;
  backend: Backend;
  saveStatus: SaveStatus;
  syncNotice: SyncNotice | null;
  dismissSyncNotice: () => void;
  // clients
  addClient: (c: Pick<Client, 'name' | 'estateName' | 'advisor' | 'notes'>) => Client;
  updateClient: (id: string, patch: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  // accounts
  addAccount: (clientId: string, draft: AccountDraft) => Account;
  updateAccount: (id: string, patch: Partial<AccountDraft>, sourceLabel?: string) => void;
  deleteAccount: (id: string) => void;
  // trusts / categories
  addNode: (n: Omit<EstateNode, 'id' | 'order'>) => EstateNode;
  updateNode: (id: string, patch: Partial<EstateNode>) => void;
  deleteNode: (id: string) => void;
  // import
  commitImport: (c: ImportCommit) => ImportRecord;
  saveMappingTemplate: (t: MappingTemplate) => void;
  // settings
  addAccountType: (t: string) => void;
  removeAccountType: (t: string) => void;
  addInstitution: (name: string) => void;
  logActivity: (e: Pick<ActivityEntry, 'clientId' | 'kind' | 'summary'> & Partial<ActivityEntry>) => void;
  removeInstitution: (name: string) => void;
  updateSettings: (patch: Partial<ReportSettings>) => void;
  resetDemo: () => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children, backend, serverData }: { children: ReactNode; backend: Backend; serverData?: unknown }) {
  const [boot] = useState(() => initial(backend, serverData));
  const [data, setData] = useState<AppData>(boot.data);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' });
  const ref = useRef(data);
  // Who is making changes — recorded on every entry in the change log.
  const { session } = useAuth();
  const actorRef = useRef<Actor>({ name: 'Unknown user', email: '' });
  actorRef.current = session ? { name: session.name, email: session.email } : { name: 'Unknown user', email: '' };
  const log = (d: AppData, ...entries: ActivityEntry[]): AppData => ({ ...d, activity: [...entries, ...(d.activity ?? [])].slice(0, 20000) });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Multi-user sync: the last version this browser loaded/saved, and its server revision.
  const baseRef = useRef<AppData | null>(backend.mode === 'server' ? (migrateData(serverData) ?? null) : null);
  const revRef = useRef(revisionOf(serverData));
  const inFlight = useRef(false);
  const [syncNotice, setSyncNotice] = useState<SyncNotice | null>(null);

  /** Folds someone else's saved version into what this browser has. */
  const absorb = useCallback((raw: unknown, savedBy?: string | null) => {
    const theirs = migrateData(raw);
    if (!theirs) return;
    const mine = ref.current;
    const { data: merged, conflicts } = mergeData(baseRef.current ?? theirs, mine, theirs);
    baseRef.current = theirs;
    revRef.current = revisionOf(raw);
    if (JSON.stringify(merged) !== JSON.stringify(mine)) {
      ref.current = merged;
      setData(merged);
    }
    const who = savedBy || (raw as { _savedBy?: string })._savedBy || 'another user';
    if (conflicts.length) {
      setSyncNotice({
        tone: 'warning',
        text: `${who} changed the same ${conflicts.length === 1 ? 'item' : 'items'} you were editing (${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? '…' : ''}). Their saved version was kept — please check it.`,
      });
    } else if (JSON.stringify(merged) !== JSON.stringify(mine)) {
      setSyncNotice({ tone: 'info', text: `Updated with changes saved by ${who}.` });
    }
  }, []);

  const pushNow = useCallback(async () => {
    timer.current = null;
    if (inFlight.current) {
      timer.current = setTimeout(() => pushNow(), 200);
      return;
    }
    inFlight.current = true;
    setSaveStatus({ state: 'saving' });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const sending = ref.current;
        const r = await saveServerData(sending, revRef.current, actorRef.current.name);
        if (r.ok) {
          revRef.current = r.revision;
          baseRef.current = sending;
          setSaveStatus({ state: 'saved', at: new Date().toISOString() });
          if (ref.current !== sending && !timer.current) timer.current = setTimeout(() => pushNow(), 300);
          return;
        }
        // Someone else saved first: merge their version with ours, then try again.
        absorb(r.conflict);
      }
      setSaveStatus({ state: 'error', error: 'Could not save because others kept saving at the same time' });
    } catch (e) {
      setSaveStatus({ state: 'error', error: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      inFlight.current = false;
    }
  }, [absorb]);

  const persist = useCallback(
    (next: AppData) => {
      if (backend.mode === 'browser') {
        save(KEY, next);
        return;
      }
      // Batch rapid edits into one write.
      if (timer.current) clearTimeout(timer.current);
      setSaveStatus({ state: 'saving' });
      timer.current = setTimeout(() => pushNow(), 300);
    },
    [backend.mode, pushNow],
  );

  useEffect(() => {
    if (boot.pushToServer) persist(boot.data);
    if (backend.mode !== 'server') return;
    // Don't lose a pending save when the tab closes.
    const flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Base-Revision': String(revRef.current), 'X-User': encodeURIComponent(actorRef.current.name) },
        body: JSON.stringify(ref.current),
        keepalive: true,
      });
    };
    window.addEventListener('pagehide', flush);
    // Pick up changes other people save, every few seconds while this tab is open.
    const poll = setInterval(async () => {
      if (document.hidden || timer.current || inFlight.current) return;
      const meta = await getRevision();
      if (!meta || meta.revision <= revRef.current || timer.current || inFlight.current) return;
      try {
        absorb(await loadServerData(), meta.savedBy);
      } catch {
        /* try again next time */
      }
    }, 8000);
    return () => {
      window.removeEventListener('pagehide', flush);
      clearInterval(poll);
    };
  }, [boot, backend.mode, persist, absorb]);

  // Updates run synchronously against the latest data so actions can return what they created.
  const update = useCallback(
    (fn: (d: AppData) => AppData) => {
      const next = fn(ref.current);
      if (next === ref.current) return;
      ref.current = next;
      persist(next);
      setData(next);
    },
    [persist],
  );

  const api = useMemo<Omit<StoreCtx, 'data' | 'backend' | 'saveStatus' | 'syncNotice' | 'dismissSyncNotice'>>(
    () => ({
      addClient(c) {
        const client: Client = { ...c, id: uid('client'), createdAt: new Date().toISOString() };
        update((d) => log({ ...d, clients: [...d.clients, client] }, entry(client.id, 'client-added', actorRef.current, `Created client ${client.name} (${client.estateName})`)));
        return client;
      },
      updateClient(id, patch) {
        update((d) => {
          const before = d.clients.find((c) => c.id === id);
          if (!before) return d;
          const after = { ...before, ...patch, id };
          const changes = clientChanges(before, after);
          const next = { ...d, clients: d.clients.map((c) => (c.id === id ? after : c)) };
          return changes.length ? log(next, entry(id, 'client-updated', actorRef.current, `Updated client ${after.name}`, { changes })) : next;
        });
      },
      deleteClient(id) {
        update((d) => ({
          ...d,
          clients: d.clients.filter((c) => c.id !== id),
          nodes: d.nodes.filter((n) => n.clientId !== id),
          accounts: d.accounts.filter((a) => a.clientId !== id),
          imports: d.imports.filter((i) => i.clientId !== id),
          activity: (d.activity ?? []).filter((e) => e.clientId !== id),
        }));
      },

      addAccount(clientId, draft) {
        const now = new Date().toISOString();
        const source = draft.source ?? { kind: 'manual' as const };
        const account: Account = {
          ...draft,
          id: uid('acct'),
          clientId,
          source,
          createdAt: now,
          history: [{ date: now, value: draft.value, source: source.kind === 'manual' ? 'Manual entry' : source.fileName ?? 'Import' }],
        };
        update((d) => {
          const trust = d.nodes.find((n) => n.id === account.parentId)?.name ?? 'not in a trust';
          return log(
            { ...d, accounts: [...d.accounts, account] },
            entry(clientId, 'account-added', actorRef.current, `Added ${accountLabel(account)} — ${account.institution}, ${money(account.value)} (${trust})`, { targetId: account.id }),
          );
        });
        return account;
      },
      updateAccount(id, patch, sourceLabel = 'Manual edit') {
        update((d) => {
          const a = d.accounts.find((x) => x.id === id);
          if (!a) return d;
          const next = { ...a, ...patch, id: a.id, clientId: a.clientId } as Account;
          if (patch.value !== undefined && patch.value !== a.value) {
            next.history = [...a.history, { date: new Date().toISOString(), value: patch.value, source: sourceLabel }];
          }
          const changes = accountChanges(a, next, d.nodes);
          if (!changes.length) return d;
          const moved = changes.length === 1 && changes[0].field === 'Parent trust';
          return log(
            { ...d, accounts: d.accounts.map((x) => (x.id === id ? next : x)) },
            entry(a.clientId, 'account-updated', actorRef.current, moved ? `Moved ${accountLabel(next)} to ${changes[0].after}` : `Updated ${accountLabel(next)}`, { targetId: id, changes }),
          );
        });
      },
      deleteAccount(id) {
        update((d) => {
          const a = d.accounts.find((x) => x.id === id);
          if (!a) return d;
          return log(
            { ...d, accounts: d.accounts.filter((x) => x.id !== id) },
            entry(a.clientId, 'account-deleted', actorRef.current, `Deleted ${accountLabel(a)} — ${a.institution}, ${money(a.value)}`, { targetId: id }),
          );
        });
      },

      addNode(n) {
        let created!: EstateNode;
        update((d) => {
          const siblings = d.nodes.filter((x) => x.clientId === n.clientId && x.parentId === n.parentId);
          created = { ...n, id: uid('trust'), order: Math.max(0, ...siblings.map((s) => s.order)) + 1 };
          const parent = d.nodes.find((x) => x.id === n.parentId)?.name;
          return log(
            { ...d, nodes: [...d.nodes, created] },
            entry(n.clientId, 'trust-added', actorRef.current, `Added ${n.type === 'Category' ? 'category' : 'trust'} ${created.name} (${created.type})${parent ? ` under ${parent}` : ''}`, { targetId: created.id }),
          );
        });
        return created;
      },
      updateNode(id, patch) {
        update((d) => {
          // Guard against making a trust its own ancestor.
          if (patch.parentId && descendantIds(d.nodes, id).has(patch.parentId)) return d;
          const before = d.nodes.find((n) => n.id === id);
          if (!before) return d;
          const after = { ...before, ...patch, id };
          const changes = nodeChanges(before, after, d.nodes);
          const next = { ...d, nodes: d.nodes.map((n) => (n.id === id ? after : n)) };
          return changes.length ? log(next, entry(before.clientId, 'trust-updated', actorRef.current, `Updated ${after.name}`, { targetId: id, changes })) : next;
        });
      },
      deleteNode(id) {
        // Accounts and sub-trusts move up to the deleted trust's parent — nothing is lost.
        update((d) => {
          const node = d.nodes.find((n) => n.id === id);
          if (!node) return d;
          const movedAccts = d.accounts.filter((a) => a.parentId === id).length;
          const movedTrusts = d.nodes.filter((n) => n.parentId === id).length;
          const dest = d.nodes.find((n) => n.id === node.parentId)?.name ?? 'the estate (top level)';
          return log(
            {
              ...d,
              nodes: d.nodes.filter((n) => n.id !== id).map((n) => (n.parentId === id ? { ...n, parentId: node.parentId } : n)),
              accounts: d.accounts.map((a) => (a.parentId === id ? { ...a, parentId: node.parentId } : a)),
            },
            entry(node.clientId, 'trust-deleted', actorRef.current, `Deleted ${node.name}${movedAccts || movedTrusts ? ` — ${movedAccts} account${movedAccts === 1 ? '' : 's'} and ${movedTrusts} sub-trust${movedTrusts === 1 ? '' : 's'} moved to ${dest}` : ''}`, { targetId: id }),
          );
        });
      },

      commitImport(c) {
        const now = new Date().toISOString();
        const record: ImportRecord = {
          id: uid('imp'),
          clientId: c.clientId,
          fileName: c.fileName,
          institution: c.institution,
          importedAt: now,
          accountsAdded: 0,
          accountsReplaced: 0,
          accountsSkipped: 0,
          totalValue: 0,
          unmappedColumns: c.unmappedColumns,
          importedBy: c.importedBy,
          institutions: c.institutions,
          sheets: c.sheets,
          storedFile: c.storedFile,
        };
        update((d) => {
          const accounts = [...d.accounts];
          const changes: { field: string; before: string; after: string }[] = [];
          for (const r of c.rows) {
            const source: Account['source'] = {
              kind: 'import',
              fileName: c.fileName,
              importId: record.id,
              importedAt: now,
              institution: r.data.institution || c.institution,
              sheet: r.sheet ?? c.sheet,
              row: r.rowNumber,
              fileUrl: c.storedFile?.url,
            };
            if (r.action === 'keep') {
              record.accountsSkipped++;
              continue;
            }
            if (r.action === 'replace' && r.targetId) {
              const i = accounts.findIndex((a) => a.id === r.targetId);
              if (i >= 0) {
                const old = accounts[i];
                // Replace financial values; keep the user's organization (trust, type, name, notes).
                accounts[i] = {
                  ...old,
                  value: r.data.value,
                  distributionAmount: r.data.distributionAmount ?? old.distributionAmount,
                  distributionFrequency: r.data.distributionFrequency || old.distributionFrequency,
                  lastUpdated: r.data.lastUpdated || todayIso(),
                  owner: r.data.owner || old.owner,
                  beneficiary: r.data.beneficiary || old.beneficiary,
                  number: old.number || r.data.number,
                  source,
                  history: [...old.history, { date: now, value: r.data.value, source: c.fileName }],
                };
                record.accountsReplaced++;
                record.totalValue += r.data.value ?? 0;
                changes.push({ field: `${accountLabel(old)} (${old.institution})`, before: money(old.value, true), after: money(r.data.value, true) });
                continue;
              }
            }
            accounts.push({
              ...r.data,
              id: uid('acct'),
              clientId: c.clientId,
              source,
              createdAt: now,
              history: [{ date: now, value: r.data.value, source: c.fileName }],
            });
            record.accountsAdded++;
            record.totalValue += r.data.value ?? 0;
            changes.push({ field: `${accountLabel(r.data)} (${r.data.institution}) — new`, before: '—', after: money(r.data.value, true) });
          }
          record.totalValue = Math.round(record.totalValue * 100) / 100;
          return log(
            { ...d, accounts, imports: [record, ...d.imports] },
            entry(c.clientId, 'import', actorRef.current, `Imported ${c.fileName}: ${record.accountsAdded} added, ${record.accountsReplaced} updated, ${record.accountsSkipped} kept (${money(record.totalValue)})`, { importId: record.id, changes }),
          );
        });
        return record;
      },
      saveMappingTemplate(t) {
        // One saved mapping per spreadsheet layout (same column headers).
        const sig = t.headers.join('|');
        update((d) => ({ ...d, mappingTemplates: [t, ...d.mappingTemplates.filter((m) => m.headers.join('|') !== sig)].slice(0, 50) }));
      },

      addAccountType(t) {
        const v = t.trim();
        if (!v) return;
        update((d) => (d.accountTypes.some((x) => x.toLowerCase() === v.toLowerCase()) ? d : { ...d, accountTypes: [...d.accountTypes, v] }));
      },
      removeAccountType(t) {
        update((d) => (d.accounts.some((a) => a.type === t) ? d : { ...d, accountTypes: d.accountTypes.filter((x) => x !== t) }));
      },
      addInstitution(name) {
        const v = name.trim();
        if (!v) return;
        update((d) => {
          if (d.institutions.some((x) => x.toLowerCase() === v.toLowerCase())) return d;
          const list = d.institutions.filter((x) => x !== 'Other');
          return { ...d, institutions: [...list, v, ...(d.institutions.includes('Other') ? ['Other'] : [])] };
        });
      },
      removeInstitution(name) {
        update((d) => (d.accounts.some((a) => a.institution === name) ? d : { ...d, institutions: d.institutions.filter((x) => x !== name) }));
      },
      logActivity(e) {
        update((d) => log(d, { ...entry(e.clientId, e.kind, actorRef.current, e.summary), ...e }));
      },
      updateSettings(patch) {
        update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
      },
      resetDemo() {
        update(() => createSeedData());
      },
    }),
    [update],
  );

  const value = useMemo(() => ({ data, backend, saveStatus, syncNotice, dismissSyncNotice: () => setSyncNotice(null), ...api }), [data, backend, saveStatus, syncNotice, api]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside StoreProvider');
  return c;
}

/** Everything belonging to one client. */
export function useClient(clientId: string) {
  const { data } = useStore();
  return useMemo(() => {
    const client = data.clients.find((c) => c.id === clientId) ?? null;
    const nodes = data.nodes.filter((n) => n.clientId === clientId);
    const accounts = normalizeScope({ nodes, accounts: data.accounts.filter((a) => a.clientId === clientId) }).accounts;
    const imports = data.imports.filter((i) => i.clientId === clientId);
    return { client, nodes, accounts, imports, scope: { nodes, accounts } };
  }, [data, clientId]);
}
