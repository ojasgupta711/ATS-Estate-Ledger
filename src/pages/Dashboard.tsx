import { useState, type ReactNode } from 'react';
import {
  LuArrowRight,
  LuChartPie,
  LuCircleCheck,
  LuFileSpreadsheet,
  LuFileText,
  LuFileUp,
  LuFolderTree,
  LuHistory,
  LuLandmark,
  LuPlus,
  LuSearch,
  LuTriangleAlert,
  LuWallet,
  LuScale,
} from 'react-icons/lu';
import { ColorDot, TrustSelect } from '../components/estate';
import { Badge, Button, Callout, Card, Money, ProgressBar, TypeBadge, useToast } from '../components/ui';
import { childNodes, estateSummary, nodeSelfExcluded, nodeTotals, type EstateScope } from '../lib/calc';
import { cx, fmtDate, fmtDateTime, maskNumber, money, pct, todayIso } from '../lib/format';
import { parseMoney } from '../lib/mapping';
import { briefSummary } from '../lib/activity';
import { qualityIssues } from '../lib/quality';
import { navigate } from '../lib/router';
import { useClient, useStore } from '../state/store';
import { setPendingFile } from './importFile';

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-brand-200 uppercase">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold text-white">{value}</p>
      {sub && <p className="text-xs text-brand-300">{sub}</p>}
    </div>
  );
}

const More = ({ to, children = 'View details' }: { to: string; children?: ReactNode }) => (
  <a href={`#${to}`} className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-brand-700 hover:underline dark:text-brand-300">
    {children} <LuArrowRight className="h-3.5 w-3.5" />
  </a>
);

function MiniTree({ scope, parentId, depth, clientId }: { scope: EstateScope; parentId: string | null; depth: number; clientId: string }) {
  return (
    <>
      {childNodes(scope, parentId).map((n) => {
        const t = nodeTotals(scope, n.id);
        return (
          <div key={n.id}>
            <a href={`#/c/${clientId}/trusts/${n.id}`} className="flex items-center gap-2 rounded-lg py-1.5 pr-2 hover:bg-slate-50 dark:hover:bg-slate-800/60" style={{ paddingLeft: 8 + depth * 18 }}>
              {depth > 0 && <span className="text-slate-300 dark:text-slate-600">↳</span>}
              <ColorDot color={n.color} />
              <span className={cx('min-w-0 flex-1 truncate text-sm', depth === 0 ? 'font-medium' : 'text-slate-600 dark:text-slate-400')}>{n.name}</span>
              {nodeSelfExcluded(n) && <Badge tone="violet">excl.</Badge>}
              <Money value={t.display} className="text-sm" dashZero={t.accountCount > 0} />
            </a>
            <MiniTree scope={scope} parentId={n.id} depth={depth + 1} clientId={clientId} />
          </div>
        );
      })}
    </>
  );
}

function QuickAdd({ clientId }: { clientId: string }) {
  const { data, addAccount } = useStore();
  const { nodes } = useClient(clientId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const v = parseMoney(value);

  const submit = () => {
    if (!name.trim() || !institution.trim() || !type || !value.trim()) return setErr('Name, institution, type and value are required.');
    if (!v.ok || (v.value ?? 0) < 0) return setErr('Enter a valid value.');
    const a = addAccount(clientId, {
      name: name.trim(),
      number: '',
      institution: institution.trim(),
      type,
      parentId,
      owner: '',
      beneficiary: '',
      value: v.value,
      distributionAmount: null,
      distributionFrequency: '',
      lastUpdated: todayIso(),
      notes: '',
      excludeFromTotal: false,
    });
    toast(`${a.name} added — ${money(a.value)}`);
    setName('');
    setInstitution('');
    setType('');
    setValue('');
    setErr('');
  };

  return (
    <div className="space-y-3">
      <input className="input" placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Account name" />
      <div className="grid grid-cols-2 gap-2">
        <select className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} aria-label="Institution">
          <option value="">Institution…</option>
          {data.institutions.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Account type">
          <option value="">Account type…</option>
          {data.accountTypes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <TrustSelect nodes={nodes} value={parentId} onChange={setParentId} noneLabel="Parent trust…" />
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">$</span>
        <input className="input num pl-7" placeholder="Current value / FMV" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Current value" />
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <More to={`/c/${clientId}/accounts/new`}>Full form</More>
        <Button size="sm" onClick={submit} icon={<LuPlus className="h-4 w-4" />}>
          Add account
        </Button>
      </div>
    </div>
  );
}

export function DashboardPage({ clientId }: { clientId: string }) {
  const { data } = useStore();
  const { client, scope, accounts, nodes, imports } = useClient(clientId);
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  if (!client) return null;
  const s = estateSummary(scope, data.accountTypes);
  const issues = qualityIssues(accounts, nodes, imports, data.accountTypes);
  const errorsWarnings = issues.filter((i) => i.severity !== 'info');
  const base = `/c/${clientId}`;
  const recent = (data.activity ?? []).filter((e) => e.clientId === clientId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  const q = search.trim().toLowerCase();
  const topAccounts = accounts
    .filter((a) => !q || [a.name, a.number, a.institution, a.type].some((x) => x.toLowerCase().includes(q)))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 6);

  const typesWithValue = s.byType.filter((b) => b.count > 0);
  const maxType = Math.max(1, ...typesWithValue.map((b) => b.value));

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setPendingFile(f);
    navigate(`${base}/import`);
  };

  return (
    <div className="space-y-5">
      {/* 1. Estate total */}
      <section id="overview" className="relative overflow-hidden rounded-2xl bg-brand-900 p-5 text-white shadow-lg sm:p-7 dark:bg-brand-950 dark:ring-1 dark:ring-brand-800">
        <div className="absolute -top-20 -right-10 h-64 w-64 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.16em] text-gold-300 uppercase">{client.estateName}</p>
            <p className="mt-2 text-sm text-brand-200">Total Estate Value</p>
            <p className="num font-display text-4xl font-semibold tracking-tight sm:text-5xl" data-testid="estate-total">
              {money(s.total)}
            </p>
            {s.excludedCount > 0 && (
              <p className="mt-2 text-xs text-brand-300">
                Excludes {money(s.excludedTotal)} shown for reference ({s.excludedCount} account{s.excludedCount === 1 ? '' : 's'})
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" icon={<LuFileText className="h-4 w-4" />} href={`${base}/report`}>
              Generate Estate Summary PDF
            </Button>
            <Button variant="secondary" className="!border-white/20 !bg-white/10 !text-white hover:!bg-white/20" icon={<LuFileUp className="h-4 w-4" />} href={`${base}/import`}>
              Import Excel File
            </Button>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 sm:grid-cols-4">
          <Stat label="Accounts" value={<span data-testid="account-count">{s.accountCount}</span>} sub={`${s.includedCount} in total`} />
          <Stat label="Trusts & categories" value={nodes.length} sub={`${childNodes(scope, null).length} top-level`} />
          <Stat label="Annual distributions" value={money(s.distributionsAnnual)} sub="annualized" />
          <Stat label="Last updated" value={fmtDate(s.lastUpdated)} sub={`${imports.length} imports`} />
        </div>
        <div className="relative mt-4 text-right">
          <a href={`#${base}/summary`} className="inline-flex items-center gap-1 text-xs font-medium text-gold-300 hover:underline">
            Full estate summary <LuArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* 1b. Trusts — first, since trusts are set up before anything else */}
        <Card
          id="trusts"
          title="Trusts"
          subtitle="Set up trusts and categories first, then add or import accounts into them"
          icon={<LuLandmark className="h-4 w-4" />}
          action={
            <>
              <More to={`${base}/trusts/new`}>Add trust</More>
              <More to={`${base}/trusts`}>Manage</More>
            </>
          }
          className="lg:col-span-2"
          bodyClassName="p-3"
        >
          {nodes.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-slate-500">No trusts yet for this client.</p>
              <Button size="sm" href={`${base}/trusts/new`} icon={<LuPlus className="h-4 w-4" />}>
                Add the first trust
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {nodes.map((n) => {
              const t = nodeTotals(scope, n.id);
              return (
                <a key={n.id} href={`#${base}/trusts/${n.id}`} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-brand-300 hover:bg-brand-50/40 dark:border-slate-800 dark:hover:border-brand-700 dark:hover:bg-brand-900/20">
                  <ColorDot color={n.color} className="h-8 w-1.5 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{n.name}</p>
                    <p className="text-xs text-slate-500">
                      {n.type} · {t.accountCount} acct{t.accountCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Money value={t.display} className="text-sm font-semibold" dashZero={t.accountCount > 0} />
                </a>
              );
            })}
          </div>
        </Card>

        {/* 3. Hierarchy */}
        <Card id="hierarchy" title="Estate hierarchy" icon={<LuFolderTree className="h-4 w-4" />} action={<More to={`${base}/hierarchy`}>Open tree</More>} bodyClassName="p-2 sm:p-3">
          <div className="mb-1 flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-semibold">{client.estateName}</span>
            <Money value={s.total} className="text-sm font-semibold" />
          </div>
          <MiniTree scope={scope} parentId={null} depth={0} clientId={clientId} />
          {nodes.length === 0 && <p className="px-2 py-4 text-sm text-slate-500">No trusts yet.</p>}
        </Card>

        {/* 9. Data quality */}
        <Card id="quality" title="Data quality" icon={<LuTriangleAlert className="h-4 w-4" />} action={<More to={`${base}/quality`} />}>
          {errorsWarnings.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
              <LuCircleCheck className="h-5 w-5" /> No errors or warnings.
            </div>
          ) : (
            <ul className="space-y-2">
              {errorsWarnings.slice(0, 4).map((i) => (
                <li key={i.id} className="flex gap-2 text-sm">
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', i.severity === 'error' ? 'bg-red-500' : 'bg-amber-500')} />
                  <span>
                    <span className="font-medium">{i.title}</span>
                    <span className="block text-xs text-slate-500">{i.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex gap-2 text-xs">
            <Badge tone="red">{issues.filter((i) => i.severity === 'error').length} errors</Badge>
            <Badge tone="amber">{issues.filter((i) => i.severity === 'warning').length} warnings</Badge>
            <Badge tone="slate">{issues.filter((i) => i.severity === 'info').length} notes</Badge>
          </div>
        </Card>

        {/* 4. Accounts */}
        <Card
          id="accounts"
          className="lg:col-span-2"
          title="Accounts"
          subtitle={`${accounts.length} accounts across ${s.byInstitution.length} institutions`}
          icon={<LuWallet className="h-4 w-4" />}
          action={
            <>
              <More to={`${base}/accounts`}>All accounts</More>
            </>
          }
          bodyClassName="p-0"
        >
          <div className="border-b border-slate-100 p-3 dark:border-slate-800">
            <div className="relative">
              <LuSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input pl-9" placeholder="Search accounts…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {topAccounts.map((a) => (
              <li key={a.id}>
                <a href={`#${base}/accounts/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {a.name} <span className="font-normal text-slate-400">{maskNumber(a.number)}</span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {a.institution} · {nodes.find((n) => n.id === a.parentId)?.name ?? 'Unassigned'}
                    </p>
                  </div>
                  <span className="hidden sm:inline">
                    <TypeBadge type={a.type} />
                  </span>
                  <Money value={a.value} className="w-28 text-right text-sm font-semibold" dashZero />
                </a>
              </li>
            ))}
            {topAccounts.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No matching accounts.</li>}
          </ul>
        </Card>

        {/* 10. Manual add */}
        <Card id="add" title="Add an account manually" icon={<LuPlus className="h-4 w-4" />}>
          <QuickAdd clientId={clientId} />
        </Card>

        {/* 5–7. Import */}
        <Card id="import" title="Import Excel or CSV" subtitle="Schwab, Nationwide or any custodian" icon={<LuFileUp className="h-4 w-4" />} className="lg:col-span-2">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              onFile(e.dataTransfer.files?.[0]);
            }}
            className={cx(
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition',
              dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40',
            )}
          >
            <LuFileSpreadsheet className="mb-2 h-8 w-8 text-brand-600 dark:text-brand-300" />
            <span className="text-sm font-medium">Drop an .xlsx or .csv file here, or click to browse</span>
            <span className="mt-1 text-xs text-slate-500">You’ll preview it, map columns and review duplicates before anything is saved.</span>
            <input type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="dash-file" />
          </label>
          <ol className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            {['Upload', 'Preview', 'Map columns', 'Review & duplicates', 'Confirm'].map((st, i) => (
              <li key={st} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/50">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-900 text-[10px] font-semibold text-white dark:bg-brand-500">{i + 1}</span>
                {st}
              </li>
            ))}
          </ol>
        </Card>

        {/* 8. Recent changes */}
        <Card id="imports" title="Recent changes" icon={<LuHistory className="h-4 w-4" />} action={<More to={`${base}/imports`}>All changes</More>} bodyClassName="p-0">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="recent-changes">
            {recent.map((e) => (
              <li key={e.id}>
                <a href={`#${base}/imports`} className="block px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50" title={e.summary}>
                  <span className="block truncate text-sm">{briefSummary(e)}</span>
                  <span className="block text-xs text-slate-500 tabular-nums">{fmtDateTime(e.at)}</span>
                </a>
              </li>
            ))}
            {recent.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No changes yet.</li>}
          </ul>
        </Card>

        {/* By account type */}
        <Card id="breakdown" title="By account type" icon={<LuChartPie className="h-4 w-4" />} action={<More to={`${base}/breakdown`} />}>
          <ul className="space-y-3">
            {typesWithValue.map((b) => (
              <li key={b.key}>
                <a href={`#${base}/breakdown/${encodeURIComponent(b.key)}`} className="block">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{b.key}</span>
                    <span className="text-slate-500">
                      <Money value={b.value} className="font-medium text-slate-900 dark:text-white" /> · {pct(b.value, s.total)}
                    </span>
                  </div>
                  <ProgressBar value={(b.value / maxType) * 100} />
                </a>
              </li>
            ))}
            {typesWithValue.length === 0 && <p className="text-sm text-slate-500">No accounts yet.</p>}
          </ul>
        </Card>

        {/* 12. PDF */}
        <Card id="report" title="Estate summary PDF" icon={<LuFileText className="h-4 w-4" />}>
          <p className="text-sm text-slate-600 dark:text-slate-400">A client-ready summary with every trust, account, subtotal and the total estate value — calculated from the data above.</p>
          <Button className="mt-4 w-full" icon={<LuFileText className="h-4 w-4" />} href={`${base}/report`}>
            Generate Estate Summary PDF
          </Button>
          <a href={`#${base}/summary`} className="mt-3 flex items-center justify-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
            <LuScale className="h-3.5 w-3.5" /> Review totals first
          </a>
        </Card>
      </div>

      {s.unassignedCount > 0 && (
        <Callout tone="warning" title={`${s.unassignedCount} account${s.unassignedCount === 1 ? ' is' : 's are'} not assigned to a trust`}>
          They are included in the total but will appear under “Other Accounts” on the report. <a className="underline" href={`#${base}/hierarchy`}>Review the hierarchy</a>.
        </Callout>
      )}
    </div>
  );
}
