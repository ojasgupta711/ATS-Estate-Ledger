import { useState } from 'react';
import { LuCircleAlert, LuCircleCheck, LuFileSpreadsheet, LuFileText, LuHistory, LuInfo, LuLandmark, LuTriangleAlert, LuUpload, LuUsers, LuWallet } from 'react-icons/lu';
import { KIND_LABEL, kindGroup, type KindGroup } from '../lib/activity';
import type { ActivityEntry, ActivityKind } from '../types';
import { AccountsTable } from '../components/AccountsTable';
import { Badge, Button, Card, EmptyState, PageHeader } from '../components/ui';
import { cx, fmtDateTime, money } from '../lib/format';
import { qualityIssues, type QualityIssue, type Severity } from '../lib/quality';
import { downloadUrl } from '../lib/api';
import { useClient, useStore } from '../state/store';

function ChangeIcon({ kind }: { kind: ActivityKind }) {
  const g = kindGroup(kind);
  const Icon = g === 'imports' ? LuFileSpreadsheet : g === 'accounts' ? LuWallet : g === 'trusts' ? LuLandmark : kind === 'report' ? LuFileText : LuUsers;
  const tone =
    kind.endsWith('deleted') ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    : g === 'imports' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : g === 'trusts' ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
    : 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200';
  return (
    <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', tone)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

function whenTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** One entry in the change log, with an expandable list of before → after values. */
export function ChangeRow({ e, base, showDate }: { e: ActivityEntry; base: string; showDate?: boolean }) {
  const [open, setOpen] = useState(false);
  const { accounts, nodes } = useClient(e.clientId);
  const g = kindGroup(e.kind);
  const link =
    e.importId ? { to: `${base}/imports/${e.importId}`, label: 'Import details' }
    : g === 'accounts' && e.targetId && accounts.some((a) => a.id === e.targetId) ? { to: `${base}/accounts/${e.targetId}`, label: 'View account' }
    : g === 'trusts' && e.targetId && nodes.some((n) => n.id === e.targetId) ? { to: `${base}/trusts/${e.targetId}`, label: 'View trust' }
    : e.kind === 'report' ? { to: `${base}/report`, label: 'PDF Report' }
    : null;
  return (
    <li className="flex gap-3 px-4 py-3 sm:px-5" data-testid="change-row">
      <ChangeIcon kind={e.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{e.summary}</p>
          <span className="shrink-0 text-xs whitespace-nowrap text-slate-500 tabular-nums">{showDate ? fmtDateTime(e.at) : whenTime(e.at)}</span>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <Badge tone={e.kind.endsWith('deleted') ? 'red' : g === 'imports' ? 'green' : g === 'trusts' ? 'violet' : 'brand'}>{KIND_LABEL[e.kind]}</Badge>
          <span title={e.user.email}>by {e.user.name}</span>
          {e.changes && e.changes.length > 0 && (
            <button className="cursor-pointer font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? 'Hide' : 'Show'} {e.changes.length} change{e.changes.length === 1 ? '' : 's'}
            </button>
          )}
          {link && (
            <a className="font-medium text-brand-700 hover:underline dark:text-brand-300" href={`#${link.to}`}>
              {link.label} →
            </a>
          )}
        </p>
        {open && e.changes && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[420px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/40">
                <tr>
                  <th className="px-3 py-1.5 font-medium">{e.kind === 'import' ? 'Account' : 'Field'}</th>
                  <th className="px-3 py-1.5 font-medium">Before</th>
                  <th className="px-3 py-1.5 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {e.changes.map((c, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{c.field}</td>
                    <td className="num px-3 py-1.5 whitespace-pre-line text-slate-500 line-through decoration-slate-300">{c.before}</td>
                    <td className="num px-3 py-1.5 font-medium whitespace-pre-line">{c.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </li>
  );
}

const FILTERS: { key: 'all' | KindGroup; label: string }[] = [
  { key: 'all', label: 'All changes' },
  { key: 'imports', label: 'Excel imports' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'trusts', label: 'Trusts & categories' },
  { key: 'other', label: 'Client & reports' },
];

export function ImportHistoryPage({ clientId }: { clientId: string }) {
  const { data } = useStore();
  const { client, imports } = useClient(clientId);
  const [filter, setFilter] = useState<'all' | KindGroup>('all');
  const [person, setPerson] = useState('');
  const [q, setQ] = useState('');
  if (!client) return null;
  const base = `/c/${clientId}`;
  const all = (data.activity ?? []).filter((e) => e.clientId === clientId).sort((a, b) => b.at.localeCompare(a.at));
  const people = [...new Map(all.map((e) => [e.user.email || e.user.name, e.user])).values()];
  const qq = q.trim().toLowerCase();
  const shown = all.filter(
    (e) =>
      (filter === 'all' || kindGroup(e.kind) === filter) &&
      (!person || (e.user.email || e.user.name) === person) &&
      (!qq || e.summary.toLowerCase().includes(qq) || e.changes?.some((c) => `${c.field} ${c.before} ${c.after}`.toLowerCase().includes(qq))),
  );
  const days: { day: string; items: ActivityEntry[] }[] = [];
  for (const e of shown) {
    const day = dayLabel(e.at);
    if (days[days.length - 1]?.day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(e);
  }

  return (
    <>
      <PageHeader
        eyebrow={client.estateName}
        title="Changes / Import History"
        subtitle="Every change anyone makes to this client — imports, accounts, trusts and reports — with who made it and when."
        back={{ to: base, label: 'Overview' }}
        actions={
          <Button href={`${base}/import`} icon={<LuUpload className="h-4 w-4" />}>
            Import Excel File
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => {
            const n = f.key === 'all' ? all.length : all.filter((e) => kindGroup(e.kind) === f.key).length;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cx(
                  'shrink-0 cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium',
                  filter === f.key ? 'border-brand-900 bg-brand-900 text-white dark:border-brand-400 dark:bg-brand-500' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
                )}
              >
                {f.label} <span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 gap-2 lg:justify-end">
          <select className="input lg:w-48" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.email || p.name} value={p.email || p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <input className="input lg:w-64" placeholder="Search changes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search changes" />
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<LuHistory className="h-6 w-6" />} title="No changes yet" body="Adding or editing accounts and trusts, importing a spreadsheet or generating the PDF will show up here." />
        </Card>
      ) : (
        <div className="space-y-5">
          {days.map((d) => (
            <section key={d.day}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{d.day}</h2>
              <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
                {d.items.map((e) => (
                  <ChangeRow key={e.id} e={e} base={base} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500">
        {imports.length} spreadsheet import{imports.length === 1 ? '' : 's'} on file. Times are shown in your computer’s time zone.
      </p>
    </>
  );
}

export function ImportDetailPage({ clientId, importId }: { clientId: string; importId: string }) {
  const { client, imports, accounts } = useClient(clientId);
  const imp = imports.find((i) => i.id === importId);
  const base = `/c/${clientId}`;
  if (!client) return null;
  if (!imp) return <Card>Import not found.</Card>;
  const fromFile = accounts.filter((a) => a.source.importId === imp.id);
  return (
    <>
      <PageHeader eyebrow="Import" title={imp.fileName} subtitle={`${imp.institutions && imp.institutions.length > 1 ? imp.institutions.join(', ') : imp.institution} · imported ${fmtDateTime(imp.importedAt)} by ${imp.importedBy}`}
        actions={
          imp.storedFile ? (
            <>
              <a className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800" href={imp.storedFile.url} target="_blank" rel="noopener">
                Open original file
              </a>
              <a className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-medium text-white hover:bg-brand-800 dark:bg-brand-500" href={downloadUrl(imp.storedFile.url)} download={imp.fileName}>
                Download
              </a>
            </>
          ) : undefined
        } back={{ to: `${base}/imports`, label: 'Import history' }} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Accounts added', imp.accountsAdded],
          ['Accounts replaced', imp.accountsReplaced],
          ['Kept existing', imp.accountsSkipped],
          ['Value imported', money(imp.totalValue)],
        ].map(([l, v]) => (
          <div key={l as string} className="card p-4">
            <p className="text-xs text-slate-500 uppercase">{l}</p>
            <p className="num text-xl font-semibold">{v}</p>
          </div>
        ))}
      </div>
      {imp.unmappedColumns.length > 0 && (
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Columns not imported: {imp.unmappedColumns.map((c) => <Badge key={c} className="mr-1">{c}</Badge>)}
        </p>
      )}
      <h2 className="mb-2 text-sm font-semibold">Accounts whose current value comes from this file</h2>
      {fromFile.length ? <AccountsTable clientId={clientId} accounts={fromFile} showFilters={false} /> : <Card><p className="text-sm text-slate-500">No accounts currently use this file as their source (they may have been updated by a newer import).</p></Card>}
    </>
  );
}

const sevStyle: Record<Severity, { icon: typeof LuInfo; cls: string; label: string }> = {
  error: { icon: LuCircleAlert, cls: 'text-red-600 dark:text-red-400', label: 'Errors' },
  warning: { icon: LuTriangleAlert, cls: 'text-amber-600 dark:text-amber-400', label: 'Warnings' },
  info: { icon: LuInfo, cls: 'text-brand-600 dark:text-brand-300', label: 'Notes' },
};

function IssueRow({ i, base }: { i: QualityIssue; base: string }) {
  const S = sevStyle[i.severity];
  const link = i.accountId ? `${base}/accounts/${i.accountId}${['missing-value', 'invalid-value', 'missing-type', 'unknown-type', 'missing-trust', 'broken-trust', 'missing-institution', 'stale'].includes(i.kind) ? '?edit=1' : ''}` : i.nodeId ? `${base}/trusts/${i.nodeId}` : i.importId ? `${base}/imports/${i.importId}` : base;
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <S.icon className={cx('mt-0.5 h-4 w-4 shrink-0', S.cls)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{i.title}</p>
        <p className="text-xs text-slate-500">{i.detail}</p>
      </div>
      <a href={`#${link}`} className="shrink-0 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
        {i.kind === 'duplicate' ? 'Review' : i.accountId ? 'Fix' : 'Open'} →
      </a>
    </li>
  );
}

export function QualityPage({ clientId }: { clientId: string }) {
  const { data } = useStore();
  const { client, accounts, nodes, imports } = useClient(clientId);
  if (!client) return null;
  const base = `/c/${clientId}`;
  const issues = qualityIssues(accounts, nodes, imports, data.accountTypes);
  const groups = (['error', 'warning', 'info'] as Severity[]).map((s) => ({ s, list: issues.filter((i) => i.severity === s) }));
  return (
    <>
      <PageHeader eyebrow={client.estateName} title="Data quality" subtitle="Checks run automatically whenever accounts are added, edited, deleted or imported." back={{ to: base, label: 'Overview' }} />
      <div className="mb-5 grid grid-cols-3 gap-3">
        {groups.map(({ s, list }) => {
          const S = sevStyle[s];
          return (
            <div key={s} className="card flex items-center gap-3 p-4">
              <S.icon className={cx('h-6 w-6', S.cls)} />
              <div>
                <p className="text-2xl font-semibold">{list.length}</p>
                <p className="text-xs text-slate-500">{S.label}</p>
              </div>
            </div>
          );
        })}
      </div>
      {issues.length === 0 ? (
        <Card>
          <EmptyState icon={<LuCircleCheck className="h-6 w-6 text-emerald-600" />} title="Everything looks good" body="No duplicates, missing values or broken trust links." />
        </Card>
      ) : (
        <div className="min-w-0 space-y-5">
          {groups
            .filter((g) => g.list.length)
            .map(({ s, list }) => (
              <Card key={s} title={`${sevStyle[s].label} (${list.length})`} bodyClassName="p-0">
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {list.map((i) => (
                    <IssueRow key={i.id} i={i} base={base} />
                  ))}
                </ul>
              </Card>
            ))}
        </div>
      )}
    </>
  );
}
