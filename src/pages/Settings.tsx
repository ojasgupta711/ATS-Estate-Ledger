import { useState } from 'react';
import { LuPlus, LuRotateCcw, LuTrash2 } from 'react-icons/lu';
import { ThemeToggle } from '../components/AppShell';
import { ATS_LOGO_DATA_URL } from '../data/logo';
import { Badge, Button, Card, Field, PageHeader, useConfirm, useToast } from '../components/ui';
import { DEFAULT_ACCOUNT_TYPES } from '../types';
import { useStore } from '../state/store';

export function SettingsPage() {
  const { data, addAccountType, removeAccountType, addInstitution, removeInstitution, updateSettings, resetDemo } = useStore();
  const confirm = useConfirm();
  const toast = useToast();
  const [newType, setNewType] = useState('');
  const [newInst, setNewInst] = useState('');

  const onLogo = (f: File | undefined) => {
    if (!f) return;
    if (!/image\/(png|jpeg)/.test(f.type)) return toast('Please choose a PNG or JPG image.', 'error');
    const r = new FileReader();
    r.onload = () => {
      updateSettings({ logoDataUrl: String(r.result) });
      toast('Logo saved — it will appear on the PDF report.');
    };
    r.readAsDataURL(f);
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Account types, report branding and appearance." back={{ to: '/clients', label: 'Clients' }} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Account types" subtitle="Used in the Account Type dropdown and the estate breakdown">
          <div className="flex flex-wrap gap-2">
            {data.accountTypes.map((t) => {
              const inUse = data.accounts.some((a) => a.type === t);
              const builtIn = (DEFAULT_ACCOUNT_TYPES as readonly string[]).includes(t);
              return (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pr-1 pl-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                  {t}
                  {!builtIn && (
                    <button
                      className="cursor-pointer rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={inUse}
                      title={inUse ? 'In use by an account' : 'Remove'}
                      onClick={() => removeAccountType(t)}
                    >
                      <LuTrash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {builtIn && <span className="w-1" />}
                </span>
              );
            })}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newType.trim()) return;
              addAccountType(newType);
              toast(`Added account type "${newType.trim()}"`);
              setNewType('');
            }}
          >
            <input className="input" placeholder="e.g. Inherited IRA, 529 Plan, Annuity" value={newType} onChange={(e) => setNewType(e.target.value)} />
            <Button type="submit" variant="secondary" icon={<LuPlus className="h-4 w-4" />}>
              Add
            </Button>
          </form>
        </Card>

        <Card title="Financial institutions" subtitle="Custodians and carriers in the Institution dropdown and import matching">
          <div className="flex flex-wrap gap-2">
            {data.institutions.map((t) => {
              const count = data.accounts.filter((a) => a.institution === t).length;
              return (
                <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pr-1 pl-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                  {t}
                  {count > 0 && <span className="text-xs text-slate-400">({count})</span>}
                  <button
                    className="cursor-pointer rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={count > 0}
                    title={count > 0 ? `Used by ${count} account${count === 1 ? '' : 's'}` : `Remove ${t}`}
                    aria-label={`Remove ${t}`}
                    onClick={() => removeInstitution(t)}
                  >
                    <LuTrash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newInst.trim()) return;
              addInstitution(newInst);
              toast(`Added ${newInst.trim()}`);
              setNewInst('');
            }}
          >
            <input className="input" placeholder="e.g. Allianz, Athene, Brighthouse" value={newInst} onChange={(e) => setNewInst(e.target.value)} aria-label="New institution" />
            <Button type="submit" variant="secondary" icon={<LuPlus className="h-4 w-4" />}>
              Add
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">Institutions used by an account can’t be removed. Imports recognize common variations, such as “Jackson National Life” or “Equitable”.</p>
        </Card>

        <Card title="Report branding" subtitle="Appears in the header of the estate summary PDF">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Firm name">
                <input className="input" value={data.settings.firmName} onChange={(e) => updateSettings({ firmName: e.target.value })} />
              </Field>
              <Field label="Tagline">
                <input className="input" value={data.settings.firmTagline} onChange={(e) => updateSettings({ firmTagline: e.target.value })} />
              </Field>
            </div>
            <Field label="Logo (PNG or JPG)" hint="The ATS tree is used by default. Upload a different image to replace it on the PDF.">
              <div className="flex items-center gap-3">
                <img src={data.settings.logoDataUrl ?? ATS_LOGO_DATA_URL} alt="Report logo" className="h-12 max-w-40 min-w-12 rounded border border-slate-200 bg-white object-contain p-1" />
                <label className="cursor-pointer text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
                  Upload
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} />
                </label>
                {data.settings.logoDataUrl && (
                  <button className="cursor-pointer text-sm text-red-600 hover:underline" onClick={() => updateSettings({ logoDataUrl: null })}>
                    Remove
                  </button>
                )}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={data.settings.internalUseLabel} onChange={(e) => updateSettings({ internalUseLabel: e.target.checked })} />
              Show “Internal Use Only” label with the report date
            </label>
          </div>
        </Card>

        <Card title="Appearance">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-400">Light, dark, or follow your device.</p>
            <ThemeToggle />
          </div>
        </Card>

        <Card title="Demo data" subtitle="Prototype only">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Restores the Elaine Housten sample estate and removes any changes you have made in this browser. <Badge tone="amber">Cannot be undone</Badge>
          </p>
          <Button
            className="mt-4"
            variant="secondary"
            icon={<LuRotateCcw className="h-4 w-4" />}
            onClick={async () => {
              if (await confirm({ title: 'Reset demo data?', body: 'All clients, accounts and imports in this browser will be replaced with the sample data.', confirmLabel: 'Reset data', danger: true })) {
                resetDemo();
                toast('Demo data restored');
              }
            }}
          >
            Reset demo data
          </Button>
        </Card>
      </div>
    </>
  );
}
