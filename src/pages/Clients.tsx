import { useEffect, useState } from 'react';
import { LuPlus, LuSearch, LuTrash2, LuUsers } from 'react-icons/lu';
import { Button, Card, Field, IconButton, Modal, Money, PageHeader, useToast } from '../components/ui';
import { estateSummary } from '../lib/calc';
import { fmtDate } from '../lib/format';
import { navigate, query } from '../lib/router';
import { useAuth } from '../state/auth';
import { useStore } from '../state/store';
import type { Client } from '../types';
import { sortClients } from '../lib/clients';

export function NewClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addClient } = useStore();
  const toast = useToast();
  const [name, setName] = useState('');
  const [estateName, setEstateName] = useState('');
  const [touched, setTouched] = useState(false);
  const [notes, setNotes] = useState('');

  const effectiveEstate = estateName.trim() || (name.trim() ? `${name.trim()} Estate` : '');
  const create = () => {
    setTouched(true);
    if (!name.trim()) return;
    const c = addClient({ name: name.trim(), estateName: effectiveEstate, advisor: 'ATS Trust Team', notes });
    toast(`${c.estateName} created`);
    onClose();
    navigate(`/c/${c.id}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New client estate"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create}>Create client</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Client name" required error={touched && !name.trim() ? 'Client name is required' : undefined}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Doe" autoFocus />
        </Field>
        <Field label="Estate name" hint={`Shown on the report title. Defaults to "${effectiveEstate || 'Client Name Estate'}".`}>
          <input className="input" value={estateName} onChange={(e) => setEstateName(e.target.value)} placeholder={effectiveEstate || 'e.g. Jane Doe Estate'} />
        </Field>
        <Field label="Notes">
          <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DeleteClientModal({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const { data, deleteClient } = useStore();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  if (!client) return null;
  const counts = {
    accounts: data.accounts.filter((a) => a.clientId === client.id).length,
    trusts: data.nodes.filter((n) => n.clientId === client.id).length,
    imports: data.imports.filter((i) => i.clientId === client.id).length,
  };
  const matches = typed.trim().toLowerCase() === client.estateName.trim().toLowerCase();
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Modal
      open
      onClose={close}
      title={`Delete ${client.estateName}?`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            data-testid="confirm-delete-client"
            onClick={() => {
              deleteClient(client.id);
              toast(`${client.estateName} deleted`);
              close();
            }}
          >
            Delete client
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <p>
          This permanently removes <b>{client.name}</b> and everything recorded for them: {counts.accounts} account{counts.accounts === 1 ? '' : 's'}, {counts.trusts} trust
          {counts.trusts === 1 ? '' : 's'} and categories, {counts.imports} import{counts.imports === 1 ? '' : 's'}, and the change history. It can’t be undone from the app.
        </p>
        <p className="text-xs text-slate-500">Spreadsheets and PDFs already saved in the storage folder are kept on disk. The server also keeps automatic backups of the data.</p>
        <Field label={`Type “${client.estateName}” to confirm`} htmlFor="del-confirm">
          <input id="del-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

export function ClientsPage({ path }: { path: string }) {
  const { data } = useStore();
  const { session } = useAuth();
  const [open, setOpen] = useState(query(path).get('new') === '1');
  // "New client" from the client menu while already on this page.
  const wantsNew = query(path).get('new') === '1';
  useEffect(() => {
    if (wantsNew) setOpen(true);
  }, [wantsNew, path]);
  const [toDelete, setToDelete] = useState<Client | null>(null);
  const [q, setQ] = useState('');
  const qq = q.trim().toLowerCase();
  const clients = sortClients(data.clients).filter((c) => !qq || c.estateName.toLowerCase().includes(qq) || c.name.toLowerCase().includes(qq));

  return (
    <>
      <PageHeader
        eyebrow={`Welcome, ${session?.name.split(' ')[0] ?? 'there'}`}
        title="Select a client"
        subtitle={`Choose an estate to work on, or create a new client. ${data.clients.length} client${data.clients.length === 1 ? '' : 's'}, A–Z.`}
        actions={
          <Button icon={<LuPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            New client
          </Button>
        }
      />
      {data.clients.length > 3 && (
        <div className="relative mb-4 max-w-md">
          <LuSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="client-list">
        {clients.map((c) => {
          const nodes = data.nodes.filter((n) => n.clientId === c.id);
          const accounts = data.accounts.filter((a) => a.clientId === c.id);
          const s = estateSummary({ nodes, accounts }, data.accountTypes);
          return (
            <div key={c.id} className="card group relative transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:hover:border-brand-700" data-testid="client-card">
              <a href={`#/c/${c.id}`} className="block p-5">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="min-w-0">
                    <p className="truncate font-display text-lg font-semibold text-brand-900 dark:text-white">{c.estateName}</p>
                    <p className="text-sm text-slate-500">{c.name}</p>
                  </div>
                </div>
                <div className="mt-5 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">Total estate value</p>
                    <Money value={s.total} className="text-2xl font-semibold text-slate-900 dark:text-white" />
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>
                      {s.accountCount} accounts · {nodes.length} trusts
                    </p>
                    <p>Updated {fmtDate(s.lastUpdated)}</p>
                  </div>
                </div>
              </a>
              <IconButton label={`Delete ${c.estateName}`} onClick={() => setToDelete(c)} className="absolute top-3 right-3 text-slate-400 hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-900/30">
                <LuTrash2 className="h-4 w-4" />
              </IconButton>
            </div>
          );
        })}
        {!qq && (
          <button onClick={() => setOpen(true)} className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:hover:border-brand-600 dark:hover:text-brand-300">
            <LuUsers className="mb-2 h-6 w-6" />
            <span className="text-sm font-medium">Create a new client</span>
          </button>
        )}
      </div>
      {qq && clients.length === 0 && <p className="mt-4 text-sm text-slate-500">No clients match “{q}”.</p>}
      {data.clients.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-slate-600">No clients yet — create your first client to get started.</p>
        </Card>
      )}
      <NewClientModal
        open={open}
        onClose={() => {
          setOpen(false);
          if (wantsNew) navigate('/clients', true);
        }}
      />
      <DeleteClientModal client={toDelete} onClose={() => setToDelete(null)} />
    </>
  );
}
