import { useMemo, useState } from 'react';
import { LuArrowDown, LuArrowUp, LuChevronsUpDown, LuPencil, LuSearch, LuTrash2, LuX } from 'react-icons/lu';
import { isAccountExcluded, round2 } from '../lib/calc';
import { cx, fmtDate, maskNumber, money } from '../lib/format';
import { navigate } from '../lib/router';
import { useClient, useStore } from '../state/store';
import type { Account } from '../types';
import { Badge, IconButton, Money, TypeBadge, useConfirm, useToast } from './ui';
import { trustOptions } from './estate';

type SortKey = 'name' | 'institution' | 'type' | 'trust' | 'value' | 'lastUpdated';

export function AccountsTable({ clientId, accounts, initial, showFilters = true }: { clientId: string; accounts: Account[]; initial?: { institution?: string; type?: string; trust?: string }; showFilters?: boolean }) {
  const { deleteAccount } = useStore();
  const { nodes } = useClient(clientId);
  const confirm = useConfirm();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState(initial?.type ?? '');
  const [institution, setInstitution] = useState(initial?.institution ?? '');
  const [trust, setTrust] = useState(initial?.trust ?? '');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });

  const nodeName = (id: string | null) => nodes.find((n) => n.id === id)?.name ?? 'Unassigned';
  const institutions = [...new Set(accounts.map((a) => a.institution).filter(Boolean))].sort();
  const types = [...new Set(accounts.map((a) => a.type))].sort();

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const list = accounts.filter((a) => {
      if (type && a.type !== type) return false;
      if (institution && a.institution !== institution) return false;
      if (trust === '__none' && a.parentId !== null) return false;
      if (trust && trust !== '__none' && a.parentId !== trust) return false;
      if (!qq) return true;
      return [a.name, a.number, a.institution, a.type, a.owner, a.beneficiary, nodeName(a.parentId), a.notes].some((x) => x.toLowerCase().includes(qq));
    });
    const val = (a: Account): string | number => {
      switch (sort.key) {
        case 'value':
          return a.value ?? -1;
        case 'trust':
          return nodeName(a.parentId).toLowerCase();
        case 'lastUpdated':
          return a.lastUpdated;
        default:
          return String(a[sort.key]).toLowerCase();
      }
    };
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [accounts, q, type, institution, trust, sort, nodes]);

  const total = round2(rows.filter((a) => !isAccountExcluded(nodes, a)).reduce((s, a) => s + (a.value ?? 0), 0));
  const filtered = !!(q || type || institution || trust);

  const Th = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <th className={cx('px-3 py-2.5 font-medium', right && 'text-right')}>
      <button
        className={cx('inline-flex cursor-pointer items-center gap-1 uppercase hover:text-slate-900 dark:hover:text-white', right && 'flex-row-reverse')}
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : k === 'value' ? -1 : 1 }))}
      >
        {children}
        {sort.key === k ? sort.dir === 1 ? <LuArrowUp className="h-3 w-3" /> : <LuArrowDown className="h-3 w-3" /> : <LuChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  const remove = async (a: Account) => {
    const ok = await confirm({
      title: 'Delete account?',
      body: (
        <p>
          <b>{a.name}</b> ({maskNumber(a.number)}) worth <b>{money(a.value, true)}</b> will be removed and the estate total will drop by that amount. This cannot be undone.
        </p>
      ),
      confirmLabel: 'Delete account',
      danger: true,
    });
    if (ok) {
      deleteAccount(a.id);
      toast(`${a.name} deleted`);
    }
  };

  return (
    <div className="card overflow-hidden">
      {showFilters && (
        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 lg:flex-row dark:border-slate-800">
          <div className="relative flex-1">
            <LuSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search name, number, owner, beneficiary, notes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:flex">
            <select className="input lg:w-40" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select className="input lg:w-44" value={institution} onChange={(e) => setInstitution(e.target.value)} aria-label="Filter by institution">
              <option value="">All institutions</option>
              {institutions.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select className="input lg:w-52" value={trust} onChange={(e) => setTrust(e.target.value)} aria-label="Filter by trust">
              <option value="">All trusts</option>
              <option value="__none">Unassigned</option>
              {trustOptions(nodes).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 bg-slate-50 px-4 py-2 text-xs text-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
        <span>
          {rows.length} of {accounts.length} accounts · <b className="num text-slate-900 dark:text-white">{money(total)}</b> {filtered ? 'in view' : 'total'}
        </span>
        {filtered && (
          <button
            className="inline-flex cursor-pointer items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => {
              setQ('');
              setType('');
              setInstitution('');
              setTrust('');
            }}
          >
            <LuX className="h-3 w-3" /> Clear filters
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-[11px] tracking-wide text-slate-500 dark:border-slate-800">
            <tr>
              <Th k="name">Account</Th>
              <Th k="institution">Institution</Th>
              <Th k="type">Type</Th>
              {showFilters && <Th k="trust">Parent trust</Th>}
              <Th k="lastUpdated">Updated</Th>
              <Th k="value" right>
                Value / FMV
              </Th>
              <th className="w-20 px-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((a) => (
              <tr key={a.id} className="group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => navigate(`/c/${clientId}/accounts/${a.id}`)}>
                <td className="min-w-44 px-3 py-2.5">
                  <p className="font-medium text-slate-900 dark:text-slate-100">{a.name}</p>
                  <p className="font-mono text-xs text-slate-500">{maskNumber(a.number)}</p>
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{a.institution || <span className="text-red-600">Missing</span>}</td>
                <td className="px-3 py-2.5">
                  <TypeBadge type={a.type} />
                </td>
                {showFilters && <td className="max-w-56 truncate px-3 py-2.5 text-slate-600 dark:text-slate-300">{nodeName(a.parentId)}</td>}
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">
                  {fmtDate(a.lastUpdated)}
                  <span className="block text-[11px] text-slate-400">{a.source.kind === 'import' ? a.source.fileName : 'Manual'}</span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Money value={a.value} className="font-semibold" dashZero />
                  {isAccountExcluded(nodes, a) && (
                    <span className="block">
                      <Badge tone="violet">not in total</Badge>
                    </span>
                  )}
                </td>
                <td className="px-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <IconButton label={`Edit ${a.name}`} onClick={() => navigate(`/c/${clientId}/accounts/${a.id}?edit=1`)}>
                    <LuPencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton label={`Delete ${a.name}`} onClick={() => remove(a)} className="hover:!text-red-600">
                    <LuTrash2 className="h-4 w-4" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {rows.map((a) => (
          <li key={a.id}>
            <a href={`#/c/${clientId}/accounts/${a.id}`} className="block px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-slate-500">
                    {a.institution} · {maskNumber(a.number)}
                  </p>
                </div>
                <Money value={a.value} className="font-semibold" dashZero />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <TypeBadge type={a.type} />
                <span className="truncate">{nodeName(a.parentId)}</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="px-4 py-10 text-center text-sm text-slate-500">No accounts match.</p>}
    </div>
  );
}
