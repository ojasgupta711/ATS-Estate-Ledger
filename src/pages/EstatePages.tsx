import { useState, type ReactNode } from 'react';
import { LuCircleCheck, LuPlus, LuTriangleAlert } from 'react-icons/lu';
import { AccountsTable } from '../components/AccountsTable';
import { ColorDot, EstateTree, trustOptions } from '../components/estate';
import { Badge, Button, Callout, Card, Money, PageHeader, ProgressBar } from '../components/ui';
import { annualized, estateSummary, nodeSelfExcluded, nodeTotals, round2 } from '../lib/calc';
import { cx, fmtDate, money, pct } from '../lib/format';
import { useClient, useStore } from '../state/store';

function Metric({ label, value, sub, testId }: { label: string; value: ReactNode; sub?: ReactNode; testId?: string }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="num mt-1 text-2xl font-semibold text-brand-900 dark:text-white" data-testid={testId}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Table({ head, children, foot }: { head: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-y border-slate-100 bg-slate-50 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-800/40">{head}</thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
        {foot && <tfoot className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">{foot}</tfoot>}
      </table>
    </div>
  );
}
const th = 'px-4 py-2.5 font-medium sm:px-5';
const td = 'px-4 py-2.5 sm:px-5';

export function SummaryPage({ clientId }: { clientId: string }) {
  const { data } = useStore();
  const { client, scope, nodes } = useClient(clientId);
  if (!client) return null;
  const s = estateSummary(scope, data.accountTypes);
  const base = `/c/${clientId}`;

  const topSum = round2(s.byTopNode.filter((b) => !b.excluded).reduce((x, b) => x + b.value, 0));
  const typeSum = round2(s.byType.reduce((x, b) => x + b.value, 0));
  const instSum = round2(s.byInstitution.reduce((x, b) => x + b.value, 0));
  const reconciles = topSum === s.total && typeSum === s.total && instSum === s.total;

  return (
    <>
      <PageHeader eyebrow={client.name} title="Estate summary" subtitle="Every total below is calculated from the account values — nothing is typed in by hand." back={{ to: base, label: 'Overview' }} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total estate value" value={money(s.total)} testId="summary-total" sub={s.excludedCount ? `${money(s.excludedTotal)} excluded` : 'All accounts included'} />
        <Metric label="Total accounts" value={s.accountCount} sub={`${s.includedCount} counted in total`} />
        <Metric label="Total distributions" value={money(s.distributionsAnnual)} sub="Annualized from each account’s frequency" />
        <Metric label="Most recent value" value={fmtDate(s.lastUpdated)} sub={`${nodes.length} trusts & categories`} />
      </div>

      <div className="mt-4">
        {reconciles ? (
          <Callout tone="success" title="Totals reconcile">
            Trust totals, account-type totals and institution totals each add up to {money(s.total, true)}.
          </Callout>
        ) : (
          <Callout tone="warning" title="Totals do not reconcile">
            By trust {money(topSum, true)} · by type {money(typeSum, true)} · by institution {money(instSum, true)}. Check the Data Quality page.
          </Callout>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Total value by trust" subtitle="Top-level trusts and categories, including sub-trusts">
          <Table
            head={
              <tr>
                <th className={th}>Trust / category</th>
                <th className={cx(th, 'text-right')}>Accounts</th>
                <th className={cx(th, 'text-right')}>Value</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td}>Total estate value</td>
                <td className={cx(td, 'text-right')}>{s.includedCount}</td>
                <td className={cx(td, 'num text-right')}>{money(s.total)}</td>
              </tr>
            }
          >
            {trustOptions(nodes).map((o) => {
              const t = nodeTotals(scope, o.id);
              return (
                <tr key={o.id}>
                  <td className={td} style={{ paddingLeft: 16 + o.depth * 18 }}>
                    <a href={`#${base}/trusts/${o.id}`} className="flex items-center gap-2 hover:underline">
                      <ColorDot color={o.node.color} />
                      <span className={o.depth === 0 ? 'font-medium' : 'text-slate-600 dark:text-slate-400'}>{o.node.name}</span>
                      {nodeSelfExcluded(o.node) && <Badge tone="violet">excluded</Badge>}
                    </a>
                  </td>
                  <td className={cx(td, 'text-right text-slate-500')}>{t.accountCount}</td>
                  <td className={cx(td, 'num text-right', o.depth === 0 && 'font-semibold')}>{money(nodeSelfExcluded(o.node) ? t.rollup : t.rollupIncluded)}</td>
                </tr>
              );
            })}
            {s.unassignedCount > 0 && (
              <tr>
                <td className={cx(td, 'text-amber-700 dark:text-amber-400')}>Not assigned to a trust</td>
                <td className={cx(td, 'text-right')}>{s.unassignedCount}</td>
                <td className={cx(td, 'num text-right font-semibold')}>{money(s.unassignedValue)}</td>
              </tr>
            )}
          </Table>
          <p className="mt-3 text-xs text-slate-500">Sub-trust rows are already included in their parent’s value. Excluded trusts are shown for reference only.</p>
        </Card>

        <Card title="Total value by account type">
          <Table
            head={
              <tr>
                <th className={th}>Account type</th>
                <th className={cx(th, 'text-right')}>Accounts</th>
                <th className={cx(th, 'text-right')}>Value</th>
                <th className={cx(th, 'text-right')}>Share</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td}>Total</td>
                <td className={cx(td, 'text-right')}>{s.includedCount}</td>
                <td className={cx(td, 'num text-right')}>{money(typeSum)}</td>
                <td className={cx(td, 'text-right')}>100%</td>
              </tr>
            }
          >
            {s.byType.map((b) => (
              <tr key={b.key} className={b.count === 0 ? 'text-slate-400' : ''}>
                <td className={td}>
                  <a href={`#${base}/breakdown/${encodeURIComponent(b.key)}`} className="hover:underline">
                    {b.key}
                  </a>
                </td>
                <td className={cx(td, 'text-right')}>{b.count}</td>
                <td className={cx(td, 'num text-right')}>{money(b.value)}</td>
                <td className={cx(td, 'text-right')}>{pct(b.value, s.total)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Total value by financial institution">
          <Table
            head={
              <tr>
                <th className={th}>Institution</th>
                <th className={cx(th, 'text-right')}>Accounts</th>
                <th className={cx(th, 'text-right')}>Value</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td}>Total</td>
                <td className={cx(td, 'text-right')}>{s.includedCount}</td>
                <td className={cx(td, 'num text-right')}>{money(instSum)}</td>
              </tr>
            }
          >
            {s.byInstitution.map((b) => (
              <tr key={b.key}>
                <td className={td}>
                  <a className="hover:underline" href={`#${base}/accounts?institution=${encodeURIComponent(b.key)}`}>
                    {b.key}
                  </a>
                  <div className="mt-1 max-w-40">
                    <ProgressBar value={(b.value / (s.total || 1)) * 100} />
                  </div>
                </td>
                <td className={cx(td, 'text-right')}>{b.count}</td>
                <td className={cx(td, 'num text-right')}>{money(b.value)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Distributions" subtitle="Annualized: monthly ×12, quarterly ×4, semi-annual ×2">
          <Table
            head={
              <tr>
                <th className={th}>Account</th>
                <th className={cx(th, 'text-right')}>Amount</th>
                <th className={th}>Frequency</th>
                <th className={cx(th, 'text-right')}>Annual</th>
              </tr>
            }
            foot={
              <tr>
                <td className={td} colSpan={3}>
                  Total distributions
                </td>
                <td className={cx(td, 'num text-right')}>{money(s.distributionsAnnual, true)}</td>
              </tr>
            }
          >
            {scope.accounts
              .filter((a) => a.distributionAmount)
              .map((a) => (
                <tr key={a.id}>
                  <td className={td}>
                    <a className="hover:underline" href={`#${base}/accounts/${a.id}`}>
                      {a.name}
                    </a>
                  </td>
                  <td className={cx(td, 'num text-right')}>{money(a.distributionAmount, true)}</td>
                  <td className={td}>{a.distributionFrequency || '—'}</td>
                  <td className={cx(td, 'num text-right')}>{money(annualized(a.distributionAmount, a.distributionFrequency), true)}</td>
                </tr>
              ))}
          </Table>
          {nodes
            .filter((n) => n.distributionInfo)
            .map((n) => (
              <div key={n.id} className="mt-3 rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-line text-slate-600 dark:bg-slate-800/40 dark:text-slate-300">
                <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{n.name}</p>
                {n.distributionInfo}
              </div>
            ))}
        </Card>
      </div>
    </>
  );
}

export function BreakdownPage({ clientId, type }: { clientId: string; type?: string }) {
  const { data } = useStore();
  const { client, scope, accounts } = useClient(clientId);
  const [open, setOpen] = useState<string | null>(type ?? null);
  if (!client) return null;
  const s = estateSummary(scope, data.accountTypes);
  const base = `/c/${clientId}`;
  const max = Math.max(1, ...s.byType.map((b) => b.value));
  const COLORS = ['#0f2744', '#c9973a', '#416aa0', '#6f9d6a', '#8d6bb3', '#c46b5b', '#5b8fa8', '#a08a55', '#7d8597', '#b0567a'];

  if (type) {
    const list = accounts.filter((a) => a.type === type);
    const bucket = s.byType.find((b) => b.key === type);
    return (
      <>
        <PageHeader eyebrow="Account type" title={type} subtitle={`${list.length} accounts · ${money(bucket?.value ?? 0)} counted in the estate total`} back={{ to: `${base}/breakdown`, label: 'All account types' }} actions={<Button href={`${base}/accounts/new?type=${encodeURIComponent(type)}`} icon={<LuPlus className="h-4 w-4" />}>Add {type} account</Button>} />
        <AccountsTable clientId={clientId} accounts={list} />
      </>
    );
  }

  // Simple donut from the type buckets
  const withValue = s.byType.filter((b) => b.value > 0);
  let acc = 0;
  const stops = withValue.map((b, i) => {
    const start = (acc / (s.total || 1)) * 360;
    acc += b.value;
    const end = (acc / (s.total || 1)) * 360;
    return `${COLORS[i % COLORS.length]} ${start}deg ${end}deg`;
  });

  return (
    <>
      <PageHeader eyebrow={client.estateName} title="Breakdown by account type" subtitle="Click a type to see its accounts." back={{ to: base, label: 'Overview' }} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <Card>
          <div className="relative mx-auto aspect-square w-52" role="img" aria-label="Estate by account type">
            <div className="absolute inset-0 rounded-full" style={{ background: stops.length ? `conic-gradient(${stops.join(',')})` : '#e2e8f0' }} />
            <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white text-center dark:bg-slate-900">
              <span className="text-[11px] text-slate-500">Estate total</span>
              <span className="num text-lg font-semibold">{money(s.total)}</span>
            </div>
          </div>
          <ul className="mt-5 space-y-1.5 text-sm">
            {withValue.map((b, i) => (
              <li key={b.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
                <span className="flex-1">{b.key}</span>
                <span className="text-slate-500">{pct(b.value, s.total)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-3">
          {s.byType.map((b) => {
            const isOpen = open === b.key;
            const list = accounts.filter((a) => a.type === b.key);
            return (
              <div key={b.key} className="card overflow-hidden">
                <button onClick={() => setOpen(isOpen ? null : b.key)} className="flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left hover:bg-slate-50 sm:px-5 dark:hover:bg-slate-800/40" aria-expanded={isOpen}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{b.key}</span>
                      <Money value={b.value} className="font-semibold" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <ProgressBar value={(b.value / max) * 100} />
                      <span className="w-24 shrink-0 text-right text-xs text-slate-500">
                        {b.count} acct{b.count === 1 ? '' : 's'} · {pct(b.value, s.total)}
                      </span>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    {list.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-slate-500">No {b.key} accounts.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {list.map((a) => (
                          <li key={a.id}>
                            <a href={`#${base}/accounts/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <span className="min-w-0 truncate">
                                {a.name} <span className="text-slate-400">· {a.institution}</span>
                              </span>
                              <Money value={a.value} dashZero />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="border-t border-slate-100 px-5 py-2 text-right dark:border-slate-800">
                      <a className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" href={`#${base}/breakdown/${encodeURIComponent(b.key)}`}>
                        Open {b.key} accounts →
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export function HierarchyPage({ clientId }: { clientId: string }) {
  const { data } = useStore();
  const { client, scope } = useClient(clientId);
  if (!client) return null;
  const s = estateSummary(scope, data.accountTypes);
  const base = `/c/${clientId}`;
  return (
    <>
      <PageHeader
        eyebrow={client.name}
        title="Estate hierarchy"
        subtitle="Trusts contain accounts and other trusts. Totals roll up automatically."
        back={{ to: base, label: 'Overview' }}
        actions={
          <>
            <Button variant="secondary" href={`${base}/trusts/new`} icon={<LuPlus className="h-4 w-4" />}>
              Add trust
            </Button>
            <Button href={`${base}/accounts/new`} icon={<LuPlus className="h-4 w-4" />}>
              Add account
            </Button>
          </>
        }
      />
      <EstateTree scope={scope} clientId={clientId} rootLabel={client.estateName} rootTotal={s.total} />
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <LuCircleCheck className="h-3.5 w-3.5 text-emerald-600" /> Trust values include their sub-trusts
        </span>
        {s.excludedCount > 0 && (
          <span className="flex items-center gap-1">
            <LuTriangleAlert className="h-3.5 w-3.5 text-violet-600" /> “Not in estate total” items ({money(s.excludedTotal)}) are shown for reference
          </span>
        )}
      </div>
    </>
  );
}
