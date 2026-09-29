import { useState } from 'react';
import { LuChevronDown, LuChevronRight, LuFolder, LuFolderOpen, LuWallet } from 'react-icons/lu';
import { childAccounts, childNodes, nodeSelfExcluded, nodeTotals, sortNodes, type EstateScope } from '../lib/calc';
import { cx, maskNumber } from '../lib/format';
import { NODE_COLORS, type EstateNode, type NodeColor } from '../types';
import { Badge, Money, TypeBadge } from './ui';

export function ColorDot({ color, className }: { color: NodeColor; className?: string }) {
  return <span className={cx('inline-block h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/10', className)} style={{ background: NODE_COLORS[color]?.hex ?? '#ccc' }} />;
}

/** Flattened, indented list of trusts for dropdowns. */
export function trustOptions(nodes: EstateNode[], exclude?: Set<string>): { id: string; label: string; depth: number; node: EstateNode }[] {
  const out: { id: string; label: string; depth: number; node: EstateNode }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of sortNodes(nodes.filter((x) => x.parentId === parent))) {
      if (exclude?.has(n.id)) continue;
      out.push({ id: n.id, label: `${'   '.repeat(depth)}${depth ? '↳ ' : ''}${n.name}`, depth, node: n });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function TrustSelect({ nodes, value, onChange, exclude, id, noneLabel = '— Directly under the estate —' }: { nodes: EstateNode[]; value: string | null; onChange: (v: string | null) => void; exclude?: Set<string>; id?: string; noneLabel?: string }) {
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{noneLabel}</option>
      {trustOptions(nodes, exclude).map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- Hierarchy tree ----------

interface TreeProps {
  scope: EstateScope;
  clientId: string;
  rootLabel: string;
  rootTotal: number;
  showAccounts?: boolean;
  initiallyOpen?: boolean;
}

export function EstateTree({ scope, clientId, rootLabel, rootTotal, showAccounts = true, initiallyOpen = true }: TreeProps) {
  const allIds = scope.nodes.map((n) => n.id);
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen ? allIds : []));
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const unassigned = childAccounts(scope, null);

  return (
    <div>
      <div className="mb-3 flex justify-end gap-3 text-xs">
        <button className="cursor-pointer font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpen(new Set(allIds))}>
          Expand all
        </button>
        <button className="cursor-pointer font-medium text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpen(new Set())}>
          Collapse all
        </button>
      </div>
      <div className="rounded-xl border border-slate-200 dark:border-slate-800" role="tree">
        <div className="flex items-center gap-3 rounded-t-xl bg-brand-900 px-4 py-3 text-white dark:bg-brand-800">
          <LuFolderOpen className="h-5 w-5 text-gold-300" />
          <span className="min-w-0 flex-1 truncate font-display text-base font-semibold">{rootLabel}</span>
          <Money value={rootTotal} className="font-semibold" />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {childNodes(scope, null).map((n) => (
            <NodeRow key={n.id} node={n} depth={0} scope={scope} open={open} toggle={toggle} clientId={clientId} showAccounts={showAccounts} />
          ))}
          {showAccounts &&
            unassigned.map((a) => (
              <AccountRow key={a.id} clientId={clientId} depth={0} a={a} warn />
            ))}
        </div>
      </div>
    </div>
  );
}

function NodeRow({ node, depth, scope, open, toggle, clientId, showAccounts }: { node: EstateNode; depth: number; scope: EstateScope; open: Set<string>; toggle: (id: string) => void; clientId: string; showAccounts: boolean }) {
  const t = nodeTotals(scope, node.id);
  const kids = childNodes(scope, node.id);
  const accts = childAccounts(scope, node.id);
  const isOpen = open.has(node.id);
  const hasChildren = kids.length > 0 || (showAccounts && accts.length > 0);
  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div className="group flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 sm:px-4 dark:hover:bg-slate-800/50" style={{ paddingLeft: `${12 + depth * 22}px` }}>
        <button
          onClick={() => toggle(node.id)}
          className={cx('flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700', !hasChildren && 'invisible')}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
        >
          {isOpen ? <LuChevronDown className="h-4 w-4" /> : <LuChevronRight className="h-4 w-4" />}
        </button>
        <ColorDot color={node.color} />
        {isOpen ? <LuFolderOpen className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" /> : <LuFolder className="hidden h-4 w-4 shrink-0 text-slate-400 sm:block" />}
        <a href={`#/c/${clientId}/trusts/${node.id}`} className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-100 dark:group-hover:text-brand-300">{node.name}</span>
            <span className="hidden sm:inline">
              <TypeBadge type={node.type} />
            </span>
            {nodeSelfExcluded(node) && <Badge tone="violet">Not in estate total</Badge>}
          </span>
          <span className="block text-xs text-slate-500">
            {t.accountCount} account{t.accountCount === 1 ? '' : 's'}
            {kids.length > 0 && ` · ${kids.length} sub-trust${kids.length === 1 ? '' : 's'}`}
          </span>
        </a>
        <div className="text-right">
          <Money value={t.display} className="text-sm font-semibold text-slate-900 dark:text-white" dashZero={t.accountCount > 0} />
          {kids.length > 0 && t.direct !== t.display && (
            <span className="block text-[11px] text-slate-500">
              <Money value={t.direct} /> direct
            </span>
          )}
        </div>
      </div>
      {isOpen && (
        <div className="border-l-2 border-slate-100 dark:border-slate-800" style={{ marginLeft: `${24 + depth * 22}px` }}>
          {showAccounts && accts.map((a) => <AccountRow key={a.id} clientId={clientId} depth={0} a={a} />)}
          {kids.map((k) => (
            <NodeRow key={k.id} node={k} depth={0} scope={scope} open={open} toggle={toggle} clientId={clientId} showAccounts={showAccounts} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRow({ a, clientId, depth, warn }: { a: EstateScope['accounts'][number]; clientId: string; depth: number; warn?: boolean }) {
  return (
    <a href={`#/c/${clientId}/accounts/${a.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-brand-50/50 sm:px-4 dark:hover:bg-brand-900/20" style={{ paddingLeft: `${16 + depth * 22}px` }}>
      <LuWallet className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-800 dark:text-slate-200">
          {a.name} <span className="text-slate-400">{a.number ? `· ${maskNumber(a.number)}` : ''}</span>
        </span>
        <span className="block text-xs text-slate-500">
          {a.institution || 'No institution'} · {a.type || 'No type'}
          {warn && <span className="ml-1 text-amber-600">· not assigned to a trust</span>}
        </span>
      </span>
      <Money value={a.value} className="text-sm text-slate-700 dark:text-slate-300" dashZero />
    </a>
  );
}
