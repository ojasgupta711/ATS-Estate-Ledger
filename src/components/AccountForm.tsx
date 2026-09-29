import { useMemo, useState } from 'react';
import { LuPlus, LuSave } from 'react-icons/lu';
import { ALWAYS_EXCLUDED_TYPE, isNodeExcluded } from '../lib/calc';
import { findDuplicates } from '../lib/duplicates';
import { money, maskNumber, todayIso } from '../lib/format';
import { parseMoney } from '../lib/mapping';
import { useClient, useStore, type AccountDraft } from '../state/store';
import { FREQUENCIES, type Account, type Frequency } from '../types';
import { TrustSelect } from './estate';
import { Button, Callout, Field, useConfirm } from './ui';


interface FormState {
  name: string;
  number: string;
  institution: string;
  type: string;
  parentId: string | null;
  owner: string;
  beneficiary: string;
  value: string;
  distributionAmount: string;
  distributionFrequency: Frequency;
  lastUpdated: string;
  notes: string;
  excludeFromTotal: boolean;
}

function toForm(a?: Partial<Account>): FormState {
  return {
    name: a?.name ?? '',
    number: a?.number ?? '',
    institution: a?.institution ?? '',
    type: a?.type ?? '',
    parentId: a?.parentId ?? null,
    owner: a?.owner ?? '',
    beneficiary: a?.beneficiary ?? '',
    value: a?.value === null || a?.value === undefined ? '' : String(a.value),
    distributionAmount: a?.distributionAmount === null || a?.distributionAmount === undefined ? '' : String(a.distributionAmount),
    distributionFrequency: a?.distributionFrequency ?? '',
    lastUpdated: a?.lastUpdated ?? todayIso(),
    notes: a?.notes ?? '',
    excludeFromTotal: a?.excludeFromTotal ?? false,
  };
}

export function AccountForm({ clientId, account, defaults, onSaved, onCancel }: { clientId: string; account?: Account; defaults?: Partial<Account>; onSaved: (a: Account) => void; onCancel?: () => void }) {
  const { data, addAccount, updateAccount, addAccountType, addInstitution } = useStore();
  const { nodes, accounts } = useClient(clientId);
  const confirm = useConfirm();
  const [f, setF] = useState<FormState>(() => toForm(account ?? defaults));
  const [submitted, setSubmitted] = useState(false);
  const [addingType, setAddingType] = useState(false);
  const [newType, setNewType] = useState('');
  const [addingInst, setAddingInst] = useState(false);
  const [newInst, setNewInst] = useState('');

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const forcedExclude = f.type === ALWAYS_EXCLUDED_TYPE || isNodeExcluded(nodes, f.parentId);
  const value = parseMoney(f.value);
  const dist = parseMoney(f.distributionAmount);

  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!f.name.trim()) errors.name = 'Account name is required';
  if (!f.institution.trim()) errors.institution = 'Financial institution is required';
  if (!f.type) errors.type = 'Choose an account type';
  if (!f.value.trim()) errors.value = 'Current value is required (enter 0 if empty)';
  else if (!value.ok) errors.value = 'Enter a number, e.g. 182953.12';
  else if ((value.value ?? 0) < 0) errors.value = 'Value cannot be negative';
  if (f.distributionAmount.trim() && !dist.ok) errors.distributionAmount = 'Enter a number';
  if (dist.value && !f.distributionFrequency) errors.distributionFrequency = 'Choose how often it is paid';
  if (!f.lastUpdated) errors.lastUpdated = 'Enter the as-of date for this value';
  const valid = Object.keys(errors).length === 0;
  const showErr = (k: keyof FormState) => (submitted ? errors[k] : undefined);

  const parentName = (a: Account) => nodes.find((n) => n.id === a.parentId)?.name ?? '';
  const dupes = useMemo(() => {
    if (!f.name.trim() && !f.number.trim()) return [];
    return findDuplicates(
      { name: f.name, number: f.number, institution: f.institution, parentName: nodes.find((n) => n.id === f.parentId)?.name },
      accounts.filter((a) => a.id !== account?.id),
      parentName,
    );
  }, [f.name, f.number, f.institution, f.parentId, accounts, nodes, account?.id]);

  const save = async () => {
    setSubmitted(true);
    if (!valid) return;
    const draft: AccountDraft = {
      name: f.name.trim(),
      number: f.number.trim(),
      institution: f.institution.trim(),
      type: f.type,
      parentId: f.parentId,
      owner: f.owner.trim(),
      beneficiary: f.beneficiary.trim(),
      value: value.value,
      distributionAmount: dist.value,
      distributionFrequency: f.distributionFrequency,
      lastUpdated: f.lastUpdated,
      notes: f.notes.trim(),
      excludeFromTotal: f.excludeFromTotal,
    };
    if (account) {
      if (draft.value !== account.value) {
        const ok = await confirm({
          title: 'Change account value?',
          body: (
            <div className="space-y-2">
              <p>
                <b>{account.name}</b> will change from <b className="num">{money(account.value, true)}</b> to <b className="num">{money(draft.value, true)}</b>.
              </p>
              <p className="text-xs text-slate-500">The previous value is kept in the account’s value history.</p>
            </div>
          ),
          confirmLabel: 'Change value',
        });
        if (!ok) return;
      }
      updateAccount(account.id, draft);
      onSaved({ ...account, ...draft });
    } else {
      if (dupes.length) {
        const ok = await confirm({
          title: 'Possible duplicate account',
          body: `This looks like ${dupes[0].account.name} (${maskNumber(dupes[0].account.number)}) that is already on file. Create a separate account anyway?`,
          confirmLabel: 'Create anyway',
        });
        if (!ok) return;
      }
      onSaved(addAccount(clientId, draft));
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-6"
      noValidate
    >
      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Account</legend>
        <Field label="Account name" required htmlFor="f-name" error={showErr('name')} className="sm:col-span-2">
          <input id="f-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Schwab IRA" />
        </Field>
        <Field label="Account number" htmlFor="f-number" hint="Used to detect duplicates. Last 4 digits appear on the report.">
          <input id="f-number" className="input font-mono" value={f.number} onChange={(e) => set('number', e.target.value)} placeholder="e.g. 5512-4497" />
        </Field>
        <Field label="Financial institution" required htmlFor="f-inst" error={showErr('institution')}>
          {addingInst ? (
            <div className="flex gap-2">
              <input className="input" autoFocus placeholder="New institution" value={newInst} onChange={(e) => setNewInst(e.target.value)} aria-label="New institution" />
              <Button
                variant="secondary"
                onClick={() => {
                  if (newInst.trim()) {
                    addInstitution(newInst);
                    set('institution', newInst.trim());
                  }
                  setAddingInst(false);
                  setNewInst('');
                }}
              >
                Add
              </Button>
            </div>
          ) : (
            <select
              id="f-inst"
              className="input"
              value={f.institution}
              onChange={(e) => {
                if (e.target.value === '__new') setAddingInst(true);
                else set('institution', e.target.value);
              }}
            >
              <option value="">Select institution…</option>
              {[...new Set([...data.institutions, ...(f.institution ? [f.institution] : [])])].map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
              <option value="__new">+ Add a new institution…</option>
            </select>
          )}
        </Field>
        <Field label="Account type" required htmlFor="f-type" error={showErr('type')}>
          {addingType ? (
            <div className="flex gap-2">
              <input className="input" autoFocus placeholder="New account type" value={newType} onChange={(e) => setNewType(e.target.value)} />
              <Button
                variant="secondary"
                onClick={() => {
                  if (newType.trim()) {
                    addAccountType(newType);
                    set('type', newType.trim());
                  }
                  setAddingType(false);
                  setNewType('');
                }}
              >
                Add
              </Button>
            </div>
          ) : (
            <select
              id="f-type"
              className="input"
              value={f.type}
              onChange={(e) => {
                if (e.target.value === '__new') setAddingType(true);
                else set('type', e.target.value);
              }}
            >
              <option value="">Select account type…</option>
              {data.accountTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__new">+ Add a new account type…</option>
            </select>
          )}
        </Field>
        <Field label="Parent trust / category" htmlFor="f-parent" hint="Where this account sits in the estate hierarchy.">
          <TrustSelect id="f-parent" nodes={nodes} value={f.parentId} onChange={(v) => set('parentId', v)} />
        </Field>
      </fieldset>

      {dupes.length > 0 && (
        <Callout tone="warning" title="Possible duplicate account">
          {dupes.slice(0, 2).map((d) => (
            <p key={d.account.id}>
              Existing: <a className="font-medium underline" href={`#/c/${clientId}/accounts/${d.account.id}`}>{d.account.name} {maskNumber(d.account.number)}</a> · {d.account.institution} · {money(d.account.value)} — {d.reasons.join(', ').toLowerCase()}
            </p>
          ))}
        </Callout>
      )}

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">People</legend>
        <Field label="Owner" htmlFor="f-owner">
          <input id="f-owner" className="input" value={f.owner} onChange={(e) => set('owner', e.target.value)} />
        </Field>
        <Field label="Beneficiary" htmlFor="f-ben">
          <input id="f-ben" className="input" value={f.beneficiary} onChange={(e) => set('beneficiary', e.target.value)} />
        </Field>
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Value & distributions</legend>
        <Field label="Current value / FMV" required htmlFor="f-value" error={showErr('value')} hint={value.ok && value.value !== null ? money(value.value, true) : undefined}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">$</span>
            <input id="f-value" className="input num pl-7" inputMode="decimal" value={f.value} onChange={(e) => set('value', e.target.value)} placeholder="0.00" />
          </div>
        </Field>
        <Field label="Value as of (last updated)" required htmlFor="f-date" error={showErr('lastUpdated')}>
          <input id="f-date" type="date" className="input" value={f.lastUpdated} onChange={(e) => set('lastUpdated', e.target.value)} />
        </Field>
        <Field label="Distribution amount" htmlFor="f-dist" error={showErr('distributionAmount')}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-slate-400">$</span>
            <input id="f-dist" className="input num pl-7" inputMode="decimal" value={f.distributionAmount} onChange={(e) => set('distributionAmount', e.target.value)} placeholder="Optional" />
          </div>
        </Field>
        <Field label="Distribution frequency" htmlFor="f-freq" error={showErr('distributionFrequency')}>
          <select id="f-freq" className="input" value={f.distributionFrequency} onChange={(e) => set('distributionFrequency', e.target.value as Frequency)}>
            <option value="">None</option>
            {FREQUENCIES.map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={f.excludeFromTotal || forcedExclude} disabled={forcedExclude} onChange={(e) => set('excludeFromTotal', e.target.checked)} />
          <span>
            Exclude from estate total
            <span className="block text-xs text-slate-500">
              {forcedExclude
                ? 'Children’s Trust accounts (and accounts in an excluded trust) are always shown for reference and left out of the total.'
                : 'Shown on the report for reference (e.g. life-insurance cash value) but not added to the total.'}
            </span>
          </span>
        </label>
      </fieldset>

      <Field label="Notes" htmlFor="f-notes">
        <textarea id="f-notes" className="input min-h-24" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Death benefit $3,500,000" />
      </Field>

      {submitted && !valid && <Callout tone="error">Please fix the highlighted fields.</Callout>}

      <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-slate-800">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" icon={account ? <LuSave className="h-4 w-4" /> : <LuPlus className="h-4 w-4" />}>
          {account ? 'Save changes' : 'Add account'}
        </Button>
      </div>
    </form>
  );
}
