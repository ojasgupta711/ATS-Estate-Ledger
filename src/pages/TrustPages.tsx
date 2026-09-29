import { useEffect, useState } from 'react';
import { LuFolderPlus, LuLandmark, LuPlus, LuSave, LuTrash2, LuArrowRightLeft } from 'react-icons/lu';
import { AccountsTable } from '../components/AccountsTable';
import { ColorDot, TrustSelect, trustOptions } from '../components/estate';
import { Badge, Button, Callout, Card, EmptyState, Field, Modal, Money, PageHeader, useConfirm, useToast } from '../components/ui';
import { ALWAYS_EXCLUDED_TYPE, childAccounts, childNodes, crtRunningTotals, descendantIds, nodePath, nodeSelfExcluded, nodeTotals } from '../lib/calc';
import { cx, maskNumber, money } from '../lib/format';
import { parseMoney } from '../lib/mapping';
import { navigate } from '../lib/router';
import { useClient, useStore } from '../state/store';
import { NODE_COLORS, NODE_TYPES, type CrtSchedule, type EstateNode, type NodeColor, type NodeType } from '../types';

const DEFAULT_COLOR: Record<string, NodeColor> = {
  Qualified: 'peach',
  Minor: 'gold',
  CRT: 'slate',
  Trust: 'sage',
  'Family Trust': 'green',
  "Children's Trust": 'lavender',
  'Sub-Trust': 'lavender',
  Category: 'blue',
  Other: 'rose',
};

export function TrustsListPage({ clientId }: { clientId: string }) {
  const { client, scope, nodes } = useClient(clientId);
  if (!client) return null;
  const base = `/c/${clientId}`;
  return (
    <>
      <PageHeader
        eyebrow={client.estateName}
        title="Trusts & categories"
        subtitle="Open a trust to edit it, see its accounts and sub-trusts, or add to it."
        back={{ to: base, label: 'Overview' }}
        actions={
          <Button href={`${base}/trusts/new`} icon={<LuFolderPlus className="h-4 w-4" />}>
            Add trust
          </Button>
        }
      />
      {nodes.length === 0 ? (
        <Card>
          <EmptyState icon={<LuLandmark className="h-6 w-6" />} title="No trusts yet" body="Create trusts and categories such as Qualified, Minors, CRT or Family Trust." action={<Button href={`${base}/trusts/new`}>Add trust</Button>} />
        </Card>
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {trustOptions(nodes).map((o) => {
            const t = nodeTotals(scope, o.id);
            return (
              <a key={o.id} href={`#${base}/trusts/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40" style={{ paddingLeft: 16 + o.depth * 24 }}>
                {o.depth > 0 && <span className="text-slate-300">↳</span>}
                <ColorDot color={o.node.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{o.node.name}</p>
                  <p className="text-xs text-slate-500">
                    {o.node.type} · {t.accountCount} account{t.accountCount === 1 ? '' : 's'}
                  </p>
                </div>
                {nodeSelfExcluded(o.node) && <Badge tone="violet">Not in total</Badge>}
                <Money value={t.display} className="font-semibold" dashZero={t.accountCount > 0} />
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

interface NodeFormState {
  name: string;
  type: NodeType;
  parentId: string | null;
  color: NodeColor;
  reportColumn: EstateNode['reportColumn'];
  excludeFromTotal: boolean;
  distributionInfo: string;
  notes: string;
}

function NodeFields({ f, set, nodes, selfId }: { f: NodeFormState; set: <K extends keyof NodeFormState>(k: K, v: NodeFormState[K]) => void; nodes: EstateNode[]; selfId?: string }) {
  const exclude = selfId ? descendantIds(nodes, selfId) : undefined;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Trust / category name" required className="sm:col-span-2">
        <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Housten Family 1998 Trust" />
      </Field>
      <Field label="Type">
        <select
          className="input"
          value={f.type}
          onChange={(e) => {
            const t = e.target.value as NodeType;
            set('type', t);
            if (!selfId) set('color', DEFAULT_COLOR[t] ?? 'slate');
          }}
        >
          {NODE_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Parent trust" hint="Leave empty for a top-level trust or category.">
        <TrustSelect nodes={nodes} value={f.parentId} onChange={(v) => set('parentId', v)} exclude={exclude} noneLabel="— Top level (under the estate) —" />
      </Field>
      <Field label="Header color" className="sm:col-span-2">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(NODE_COLORS) as NodeColor[]).map((c) => (
            <button
              type="button"
              key={c}
              onClick={() => set('color', c)}
              className={cx('h-8 w-8 cursor-pointer rounded-lg ring-2 ring-offset-2 transition dark:ring-offset-slate-900', f.color === c ? 'ring-brand-600' : 'ring-transparent')}
              style={{ background: NODE_COLORS[c].hex }}
              aria-label={NODE_COLORS[c].label}
              title={NODE_COLORS[c].label}
            />
          ))}
        </div>
      </Field>
      {!f.parentId && (
        <Field label="PDF column" hint="Where this section appears on the two-column report.">
          <select className="input" value={f.reportColumn} onChange={(e) => set('reportColumn', e.target.value as EstateNode['reportColumn'])}>
            <option value="auto">Automatic</option>
            <option value="left">Left column</option>
            <option value="right">Right column</option>
          </select>
        </Field>
      )}
      <label className="flex items-start gap-2 self-end text-sm sm:col-span-2">
        <input type="checkbox" className="mt-1" checked={f.excludeFromTotal || f.type === ALWAYS_EXCLUDED_TYPE} disabled={f.type === ALWAYS_EXCLUDED_TYPE} onChange={(e) => set('excludeFromTotal', e.target.checked)} />
        <span>
          Exclude from estate total
          <span className="block text-xs text-slate-500">
            {f.type === ALWAYS_EXCLUDED_TYPE
              ? 'Children’s Trusts are always shown for reference and left out of the total estate value.'
              : 'Everything in this trust is shown on the report but not added to the total estate value.'}
          </span>
        </span>
      </label>
      <Field label="Distribution information" className="sm:col-span-2" hint="Shown under this section on the PDF (e.g. RMD history, payout rate, tax withholding).">
        <textarea className="input min-h-24" value={f.distributionInfo} onChange={(e) => set('distributionInfo', e.target.value)} />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <textarea className="input min-h-20" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </div>
  );
}

const blankForm = (parentId: string | null): NodeFormState => ({
  name: '',
  type: parentId ? 'Sub-Trust' : 'Trust',
  parentId,
  color: parentId ? 'lavender' : 'sage',
  reportColumn: 'auto',
  excludeFromTotal: false,
  distributionInfo: '',
  notes: '',
});

export function NewTrustPage({ clientId, parentId }: { clientId: string; parentId: string | null }) {
  const { addNode } = useStore();
  const { client, nodes } = useClient(clientId);
  const toast = useToast();
  const [f, setF] = useState<NodeFormState>(() => blankForm(parentId));
  const [err, setErr] = useState('');
  if (!client) return null;
  const set = <K extends keyof NodeFormState>(k: K, v: NodeFormState[K]) => setF((s) => ({ ...s, [k]: v }));
  return (
    <>
      <PageHeader eyebrow={client.estateName} title="Add a trust or category" back={{ to: `/c/${clientId}/trusts`, label: 'Trusts' }} />
      <Card className="max-w-3xl">
        <NodeFields f={f} set={set} nodes={nodes} />
        {err && <Callout tone="error" className="mt-4">{err}</Callout>}
        <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <Button variant="secondary" onClick={() => history.back()}>
            Cancel
          </Button>
          <Button
            icon={<LuPlus className="h-4 w-4" />}
            onClick={() => {
              if (!f.name.trim()) return setErr('Enter a name for the trust.');
              const n = addNode({ ...f, name: f.name.trim(), clientId });
              toast(`${n.name} created`);
              navigate(`/c/${clientId}/trusts/${n.id}`, true);
            }}
          >
            Create trust
          </Button>
        </div>
      </Card>
    </>
  );
}

function CrtEditor({ node }: { node: EstateNode }) {
  const { updateNode } = useStore();
  const toast = useToast();
  const [crt, setCrt] = useState<CrtSchedule | undefined>(node.crt);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setCrt(node.crt);
    setDirty(false);
  }, [node.id, node.crt]);

  if (!crt) {
    return (
      <Card title="CRT payout schedule">
        <p className="text-sm text-slate-600 dark:text-slate-400">Track the initial funding, payout rate and year-by-year FMV and distributions. Running totals are calculated automatically.</p>
        <Button
          className="mt-3"
          variant="secondary"
          icon={<LuPlus className="h-4 w-4" />}
          onClick={() => {
            const y = new Date().getFullYear();
            updateNode(node.id, { crt: { initialDate: '', initialValue: null, netProceeds: null, payoutRate: null, fmvAsOfDate: '', fmvAsOf: null, rows: [{ year: y, fmv: null, distribution: null }] } });
          }}
        >
          Add payout schedule
        </Button>
      </Card>
    );
  }

  const running = crtRunningTotals(crt.rows);
  const edit = (patch: Partial<CrtSchedule>) => {
    setCrt({ ...crt, ...patch });
    setDirty(true);
  };
  const num = (v: string) => (v.trim() === '' ? null : parseMoney(v).value);
  const cell = 'input num h-8 px-2 text-right text-xs';

  return (
    <Card
      title="CRT payout schedule"
      subtitle="Running total distributions are calculated"
      action={
        dirty && (
          <Button
            size="sm"
            icon={<LuSave className="h-4 w-4" />}
            onClick={() => {
              updateNode(node.id, { crt });
              setDirty(false);
              toast('Payout schedule saved');
            }}
          >
            Save schedule
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Initial date">
          <input type="date" className="input" value={crt.initialDate} onChange={(e) => edit({ initialDate: e.target.value })} />
        </Field>
        <Field label="Initial value">
          <input className="input num" defaultValue={crt.initialValue ?? ''} onBlur={(e) => edit({ initialValue: num(e.target.value) })} />
        </Field>
        <Field label="Net proceeds">
          <input className="input num" defaultValue={crt.netProceeds ?? ''} onBlur={(e) => edit({ netProceeds: num(e.target.value) })} />
        </Field>
        <Field label="Payout rate %">
          <input className="input num" defaultValue={crt.payoutRate ?? ''} onBlur={(e) => edit({ payoutRate: num(e.target.value) })} />
        </Field>
        <Field label="FMV as of">
          <input type="date" className="input" value={crt.fmvAsOfDate} onChange={(e) => edit({ fmvAsOfDate: e.target.value })} />
        </Field>
        <Field label="FMV">
          <input className="input num" defaultValue={crt.fmvAsOf ?? ''} onBlur={(e) => edit({ fmvAsOf: num(e.target.value) })} />
        </Field>
      </div>
      <div className="-mx-4 mt-4 overflow-x-auto sm:-mx-5">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/40">
            <tr>
              <th className="px-4 py-2 font-medium">Year</th>
              <th className="px-2 py-2 text-right font-medium">FMV</th>
              <th className="px-2 py-2 text-right font-medium">Distribution by end of year</th>
              <th className="px-4 py-2 text-right font-medium">Running total distributions</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {crt.rows.map((r, i) => (
              <tr key={`${r.year}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-4 py-1">
                  <input className="input h-8 w-20 px-2 text-xs" type="number" defaultValue={r.year} onBlur={(e) => edit({ rows: crt.rows.map((x, j) => (j === i ? { ...x, year: Number(e.target.value) || x.year } : x)) })} />
                </td>
                <td className="px-2 py-1">
                  <input className={cell} defaultValue={r.fmv ?? ''} onBlur={(e) => edit({ rows: crt.rows.map((x, j) => (j === i ? { ...x, fmv: num(e.target.value) } : x)) })} />
                </td>
                <td className="px-2 py-1">
                  <input className={cell} defaultValue={r.distribution ?? ''} onBlur={(e) => edit({ rows: crt.rows.map((x, j) => (j === i ? { ...x, distribution: num(e.target.value) } : x)) })} />
                </td>
                <td className="num px-4 py-1 text-right font-medium">{money(running[i], true)}</td>
                <td>
                  <button className="cursor-pointer p-1 text-slate-400 hover:text-red-600" aria-label="Remove year" onClick={() => edit({ rows: crt.rows.filter((_, j) => j !== i) })}>
                    <LuTrash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        icon={<LuPlus className="h-3.5 w-3.5" />}
        onClick={() => edit({ rows: [...crt.rows, { year: (crt.rows.at(-1)?.year ?? new Date().getFullYear() - 1) + 1, fmv: null, distribution: null }] })}
      >
        Add year
      </Button>
    </Card>
  );
}

export function TrustDetailPage({ clientId, nodeId }: { clientId: string; nodeId: string }) {
  const { updateNode, deleteNode, updateAccount, addNode } = useStore();
  const { client, scope, nodes, accounts } = useClient(clientId);
  const confirm = useConfirm();
  const toast = useToast();
  const node = nodes.find((n) => n.id === nodeId);
  const toForm = (n: EstateNode): NodeFormState => ({ name: n.name, type: n.type, parentId: n.parentId, color: n.color, reportColumn: n.reportColumn, excludeFromTotal: n.excludeFromTotal, distributionInfo: n.distributionInfo, notes: n.notes });
  const [f, setF] = useState<NodeFormState | null>(node ? toForm(node) : null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveId, setMoveId] = useState('');
  const [subOpen, setSubOpen] = useState(false);
  const [subName, setSubName] = useState('');
  useEffect(() => {
    if (node) setF(toForm(node));
  }, [nodeId]);

  const base = `/c/${clientId}`;
  if (!client) return null;
  if (!node || !f) {
    return (
      <Card>
        <EmptyState icon={<LuLandmark className="h-6 w-6" />} title="Trust not found" action={<Button href={`${base}/trusts`}>All trusts</Button>} />
      </Card>
    );
  }
  const set = <K extends keyof NodeFormState>(k: K, v: NodeFormState[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(node));
  const t = nodeTotals(scope, node.id);
  const kids = childNodes(scope, node.id);
  const direct = childAccounts(scope, node.id);
  const path = nodePath(nodes, node.id);
  const movable = accounts.filter((a) => a.parentId !== node.id);

  const remove = async () => {
    const parent = nodes.find((n) => n.id === node.parentId);
    const ok = await confirm({
      title: `Delete ${node.name}?`,
      body: (
        <p>
          Its {direct.length} account{direct.length === 1 ? '' : 's'} and {kids.length} sub-trust{kids.length === 1 ? '' : 's'} will move to <b>{parent?.name ?? 'the estate (top level)'}</b>. No accounts are deleted and the estate total does not change.
        </p>
      ),
      confirmLabel: 'Delete trust',
      danger: true,
    });
    if (ok) {
      deleteNode(node.id);
      toast(`${node.name} deleted`);
      navigate(parent ? `${base}/trusts/${parent.id}` : `${base}/hierarchy`, true);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="normal-case">
            {client.estateName}
            {path.slice(0, -1).map((p) => (
              <span key={p.id}>
                {' › '}
                <a href={`#${base}/trusts/${p.id}`} className="hover:underline">
                  {p.name}
                </a>
              </span>
            ))}
          </span>
        }
        title={
          <span className="flex items-center gap-3">
            <ColorDot color={node.color} className="h-5 w-5" /> {node.name}
          </span>
        }
        subtitle={`${node.type} · ${t.accountCount} accounts · ${kids.length} sub-trusts`}
        back={{ to: `${base}/hierarchy`, label: 'Hierarchy' }}
        actions={
          <>
            <Button variant="secondary" icon={<LuTrash2 className="h-4 w-4" />} onClick={remove}>
              Delete trust
            </Button>
            <Button href={`${base}/accounts/new?parent=${node.id}`} icon={<LuPlus className="h-4 w-4" />}>
              Add account here
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs text-slate-500 uppercase">Total value</p>
          <Money value={t.rollup} className="text-2xl font-semibold" />
          <p className="text-xs text-slate-500">including sub-trusts</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 uppercase">Accounts directly in this trust</p>
          <Money value={t.direct} className="text-2xl font-semibold" />
          <p className="text-xs text-slate-500">{t.directCount} accounts</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-slate-500 uppercase">Counted in estate total</p>
          <Money value={t.rollupIncluded} className="text-2xl font-semibold" />
          <p className="text-xs text-slate-500">{nodeSelfExcluded(node) ? 'This trust is excluded' : t.rollupIncluded !== t.rollup ? `${money(t.rollup - t.rollupIncluded)} excluded below` : 'Fully included'}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <div className="min-w-0 space-y-5">
          <Card
            title="Accounts in this trust"
            action={
              <Button size="sm" variant="secondary" icon={<LuArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setMoveOpen(true)}>
                Assign existing
              </Button>
            }
            bodyClassName="p-0"
          >
            {direct.length ? (
              <AccountsTable clientId={clientId} accounts={direct} showFilters={false} />
            ) : (
              <EmptyState icon={<LuLandmark className="h-5 w-5" />} title="No accounts directly in this trust" body={kids.length ? 'Its value comes from the sub-trusts below.' : 'Add an account or assign an existing one.'} />
            )}
          </Card>

          <Card
            title="Sub-trusts"
            subtitle="Trusts created under this trust"
            action={
              <Button size="sm" variant="secondary" icon={<LuFolderPlus className="h-3.5 w-3.5" />} onClick={() => setSubOpen(true)}>
                Add sub-trust
              </Button>
            }
            bodyClassName="p-0"
          >
            {kids.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {kids.map((k) => {
                  const kt = nodeTotals(scope, k.id);
                  return (
                    <li key={k.id}>
                      <a href={`#${base}/trusts/${k.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <ColorDot color={k.color} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{k.name}</p>
                          <p className="text-xs text-slate-500">
                            {k.type} · {kt.accountCount} accounts
                          </p>
                        </div>
                        {nodeSelfExcluded(k) && <Badge tone="violet">Not in total</Badge>}
                        <Money value={kt.display} className="font-semibold" dashZero={kt.accountCount > 0} />
                      </a>
                    </li>
                  );
                })}
                <li className="flex justify-between bg-slate-50 px-5 py-2.5 text-sm font-semibold dark:bg-slate-800/40">
                  <span>Trust total (direct + sub-trusts)</span>
                  <Money value={t.rollup} />
                </li>
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-500">No sub-trusts.</p>
            )}
          </Card>

          {(node.type === 'CRT' || node.crt) && <CrtEditor node={node} />}
        </div>

        <Card
          title="Edit trust"
          action={
            dirty && (
              <Button
                size="sm"
                icon={<LuSave className="h-4 w-4" />}
                onClick={() => {
                  if (!f.name.trim()) return toast('Name is required', 'error');
                  updateNode(node.id, { ...f, name: f.name.trim() });
                  toast('Trust saved');
                }}
              >
                Save
              </Button>
            )
          }
        >
          <NodeFields f={f} set={set} nodes={nodes} selfId={node.id} />
          {dirty && (
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button variant="secondary" size="sm" onClick={() => setF(toForm(node))}>
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!f.name.trim()) return toast('Name is required', 'error');
                  updateNode(node.id, { ...f, name: f.name.trim() });
                  toast('Trust saved');
                }}
              >
                Save changes
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Assign an account to ${node.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoveOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!moveId}
              onClick={() => {
                const a = accounts.find((x) => x.id === moveId);
                if (!a) return;
                updateAccount(a.id, { parentId: node.id });
                toast(`${a.name} moved to ${node.name}`);
                setMoveOpen(false);
                setMoveId('');
              }}
            >
              Assign account
            </Button>
          </>
        }
      >
        <Field label="Account">
          <select className="input" value={moveId} onChange={(e) => setMoveId(e.target.value)}>
            <option value="">Choose an account…</option>
            {movable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {maskNumber(a.number)} · {money(a.value)} · currently in {nodes.find((n) => n.id === a.parentId)?.name ?? 'Unassigned'}
              </option>
            ))}
          </select>
        </Field>
        <p className="mt-3 text-xs text-slate-500">The account’s value is unchanged; only its place in the hierarchy moves. Totals update automatically.</p>
      </Modal>

      <Modal
        open={subOpen}
        onClose={() => setSubOpen(false)}
        title={`Add a sub-trust under ${node.name}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!subName.trim()}
              onClick={() => {
                const n = addNode({ ...blankForm(node.id), name: subName.trim(), clientId });
                toast(`${n.name} created`);
                setSubOpen(false);
                setSubName('');
              }}
            >
              Create sub-trust
            </Button>
          </>
        }
      >
        <Field label="Sub-trust name">
          <input className="input" autoFocus value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="e.g. Children's Trust fbo Samuel" />
        </Field>
      </Modal>
    </>
  );
}
