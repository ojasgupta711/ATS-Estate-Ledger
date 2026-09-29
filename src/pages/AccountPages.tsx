import type { ReactNode } from 'react';
import { LuDownload, LuFileSpreadsheet, LuPencil, LuPlus, LuTrash2, LuUpload, LuUserPen } from 'react-icons/lu';
import { AccountForm } from '../components/AccountForm';
import { AccountsTable } from '../components/AccountsTable';
import { ColorDot } from '../components/estate';
import { Badge, Button, Callout, Card, EmptyState, Money, PageHeader, TypeBadge, useConfirm, useToast } from '../components/ui';
import { annualized, isAccountExcluded, nodePath } from '../lib/calc';
import { daysSince, fmtDate, fmtDateTime, maskNumber, money } from '../lib/format';
import { STALE_DAYS } from '../lib/quality';
import { navigate, query } from '../lib/router';
import { useClient, useStore } from '../state/store';

export function AccountsPage({ clientId, path }: { clientId: string; path: string }) {
  const { client, accounts } = useClient(clientId);
  if (!client) return null;
  const qs = query(path);
  const base = `/c/${clientId}`;
  return (
    <>
      <PageHeader
        eyebrow={client.estateName}
        title="All accounts"
        subtitle="Search, filter and sort every account. Click a row for details."
        back={{ to: base, label: 'Overview' }}
        actions={
          <>
            <Button variant="secondary" href={`${base}/import`} icon={<LuUpload className="h-4 w-4" />}>
              Import Excel File
            </Button>
            <Button variant="gold" href={`${base}/accounts/new`} icon={<LuPlus className="h-4 w-4" />}>
              Add Account
            </Button>
          </>
        }
      />
      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={<LuFileSpreadsheet className="h-6 w-6" />} title="No accounts yet" body="Import a custodian spreadsheet or add an account manually." action={<Button href={`${base}/import`}>Import Excel File</Button>} />
        </Card>
      ) : (
        <AccountsTable clientId={clientId} accounts={accounts} initial={{ institution: qs.get('institution') ?? undefined, type: qs.get('type') ?? undefined, trust: qs.get('trust') ?? undefined }} />
      )}
    </>
  );
}

export function AddAccountPage({ clientId, path }: { clientId: string; path: string }) {
  const { client } = useClient(clientId);
  const toast = useToast();
  if (!client) return null;
  const qs = query(path);
  const base = `/c/${clientId}`;
  return (
    <>
      <PageHeader eyebrow={client.estateName} title="Add an account" subtitle="For accounts that are not available in a spreadsheet." back={{ to: `${base}/accounts`, label: 'Accounts' }} />
      <Card className="max-w-3xl">
        <AccountForm
          clientId={clientId}
          defaults={{ parentId: qs.get('parent'), type: qs.get('type') ?? '' }}
          onCancel={() => history.back()}
          onSaved={(a) => {
            toast(`${a.name} added — estate total updated`);
            navigate(`${base}/accounts/${a.id}`);
          }}
        />
      </Card>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2.5 text-sm sm:grid-cols-[180px_1fr]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900 dark:text-slate-100">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

export function AccountDetailPage({ clientId, accountId, path }: { clientId: string; accountId: string; path: string }) {
  const { deleteAccount } = useStore();
  const { client, accounts, nodes, imports } = useClient(clientId);
  const confirm = useConfirm();
  const toast = useToast();
  const a = accounts.find((x) => x.id === accountId);
  const editing = query(path).get('edit') === '1';
  const base = `/c/${clientId}`;
  if (!client) return null;
  if (!a) {
    return (
      <Card>
        <EmptyState icon={<LuFileSpreadsheet className="h-6 w-6" />} title="Account not found" body="It may have been deleted." action={<Button href={`${base}/accounts`}>Back to accounts</Button>} />
      </Card>
    );
  }
  const path2 = nodePath(nodes, a.parentId);
  const imp = imports.find((i) => i.id === a.source.importId);
  const excluded = isAccountExcluded(nodes, a);

  const remove = async () => {
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
      navigate(`${base}/accounts`, true);
    }
  };

  if (editing) {
    return (
      <>
        <PageHeader eyebrow="Edit account" title={a.name} back={{ to: `${base}/accounts/${a.id}`, label: 'Account details' }} />
        <Card className="max-w-3xl">
          <AccountForm
            clientId={clientId}
            account={a}
            onCancel={() => navigate(`${base}/accounts/${a.id}`)}
            onSaved={() => {
              toast('Changes saved');
              navigate(`${base}/accounts/${a.id}`);
            }}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1 normal-case">
            {path2.length ? path2.map((n, i) => <span key={n.id}>{i > 0 && ' › '}<a className="hover:underline" href={`#${base}/trusts/${n.id}`}>{n.name}</a></span>) : 'Not assigned to a trust'}
          </span>
        }
        title={a.name}
        subtitle={`${a.institution} · ${a.number || 'No account number'}`}
        back={{ to: `${base}/accounts`, label: 'All accounts' }}
        actions={
          <>
            <Button variant="secondary" icon={<LuTrash2 className="h-4 w-4" />} onClick={remove} className="hover:!text-red-600">
              Delete
            </Button>
            <Button icon={<LuPencil className="h-4 w-4" />} href={`${base}/accounts/${a.id}?edit=1`}>
              Edit account
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <div className="card flex flex-wrap items-end justify-between gap-4 p-5">
            <div>
              <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Current market value / FMV</p>
              <Money value={a.value} cents className="font-display text-3xl font-semibold text-brand-900 dark:text-white" />
              <p className="mt-1 text-xs text-slate-500">As of {fmtDate(a.lastUpdated)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <TypeBadge type={a.type} />
              {excluded ? <Badge tone="violet">Not in estate total</Badge> : <Badge tone="green">Included in estate total</Badge>}
            </div>
          </div>
          {a.lastUpdated && daysSince(a.lastUpdated) > STALE_DAYS && (
            <Callout tone="warning" title="Value may be out of date">
              Last updated {fmtDate(a.lastUpdated)}. Import a new statement or edit the value.
            </Callout>
          )}
          <Card title="Account details">
            <dl className="divide-y divide-slate-100 dark:divide-slate-800">
              <Row label="Account name">{a.name}</Row>
              <Row label="Account number">{a.number && <span className="font-mono">{a.number}</span>}</Row>
              <Row label="Financial institution">{a.institution}</Row>
              <Row label="Account type">{a.type}</Row>
              <Row label="Parent trust">
                {path2.length ? (
                  <a href={`#${base}/trusts/${path2[path2.length - 1].id}`} className="inline-flex items-center gap-2 hover:underline">
                    <ColorDot color={path2[path2.length - 1].color} /> {path2[path2.length - 1].name}
                  </a>
                ) : (
                  <span className="text-amber-700">Not assigned</span>
                )}
              </Row>
              <Row label="Owner">{a.owner}</Row>
              <Row label="Beneficiary">{a.beneficiary}</Row>
              <Row label="Current FMV">
                <Money value={a.value} cents />
              </Row>
              <Row label="Distribution amount">{a.distributionAmount ? <Money value={a.distributionAmount} cents /> : null}</Row>
              <Row label="Distribution frequency">
                {a.distributionFrequency}
                {a.distributionAmount && a.distributionFrequency ? <span className="text-slate-500"> · {money(annualized(a.distributionAmount, a.distributionFrequency), true)} per year</span> : null}
              </Row>
              <Row label="Last updated">{fmtDate(a.lastUpdated)}</Row>
              <Row label="Notes">{a.notes && <span className="whitespace-pre-line">{a.notes}</span>}</Row>
            </dl>
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <Card title="Source" icon={a.source.kind === 'import' ? <LuFileSpreadsheet className="h-4 w-4" /> : <LuUserPen className="h-4 w-4" />}>
            {a.source.kind === 'import' ? (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Original file</dt>
                  <dd className="font-medium break-all">{imp ? <a className="hover:underline" href={`#${base}/imports/${imp.id}`}>{a.source.fileName}</a> : a.source.fileName}</dd>
                  {(a.source.fileUrl ?? imp?.storedFile?.url) && (
                    <dd className="mt-1">
                      <a className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300" href={a.source.fileUrl ?? imp?.storedFile?.url} target="_blank" rel="noopener">
                        <LuDownload className="h-3.5 w-3.5" /> Open the original spreadsheet
                      </a>
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Source institution</dt>
                  <dd>{a.source.institution}</dd>
                </div>
                {(a.source.sheet || a.source.row) && (
                  <div>
                    <dt className="text-xs text-slate-500">Location in file</dt>
                    <dd>
                      {a.source.sheet ? `Sheet “${a.source.sheet}”, ` : ''}row {a.source.row}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-slate-500">Import date</dt>
                  <dd>{fmtDateTime(a.source.importedAt)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">Entered manually on {fmtDateTime(a.createdAt)}.</p>
            )}
          </Card>
          <Card title="Value history" subtitle="Every change is kept">
            <ol className="space-y-3">
              {[...a.history].reverse().map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-slate-500">{fmtDateTime(h.date)}</p>
                    <p className="truncate text-xs">{h.source}</p>
                  </div>
                  <Money value={h.value} cents className={i === 0 ? 'font-semibold' : 'text-slate-500'} />
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
