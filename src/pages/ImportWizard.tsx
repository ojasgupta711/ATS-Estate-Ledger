import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LuArrowLeft,
  LuArrowRight,
  LuCheck,
  LuCircleAlert,
  LuCircleCheck,
  LuCopy,
  LuFileSpreadsheet,
  LuGitCompare,
  LuTriangleAlert,
  LuUpload,
} from 'react-icons/lu';
import { TrustSelect } from '../components/estate';
import { Badge, Button, Callout, Card, Field, Modal, Money, PageHeader, useToast } from '../components/ui';
import { estateSummary } from '../lib/calc';
import { cx, maskNumber, money } from '../lib/format';
import { buildPlan, diffFields, distinctRawTypes, institutionBreakdown, suggestTypeMap, summarizePlan, type PlannedRow, type PlanSheet, type Resolution, type RowOverride } from '../lib/importPlan';
import { matchInstitution } from '../data/institutions';
import { storeFile } from '../lib/api';
import { IMPORT_FIELDS, suggestMapping, type Mapping } from '../lib/mapping';
import { detectHeaderRow, readSpreadsheet, type Workbook } from '../lib/spreadsheet';
import { useAuth } from '../state/auth';
import { useClient, useStore } from '../state/store';
import type { Account, ImportField, ImportRecord, StoredFile } from '../types';
import { takePendingFile } from './importFile';

type Step = 'upload' | 'preview' | 'map' | 'categorize' | 'review' | 'done';
const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'preview', label: 'Preview' },
  { key: 'map', label: 'Map columns' },
  { key: 'categorize', label: 'Categories' },
  { key: 'review', label: 'Review & duplicates' },
];

function guessInstitution(fileName: string, list: string[]): string {
  return matchInstitution(fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), list) ?? '';
}

/** Default-institution picker. Empty means "take it from the file". */
function InstitutionSelect({ value, onChange, list, id }: { value: string; onChange: (v: string) => void; list: string[]; id?: string }) {
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Several / detect from the file</option>
      {[...new Set([...list, ...(value ? [value] : [])])].map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </select>
  );
}

function Stepper({ step }: { step: Step }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 flex items-center gap-1 overflow-x-auto pb-1 sm:gap-2" aria-label="Import progress">
      {STEPS.map((s, i) => {
        const done = i < idx || step === 'done';
        const active = s.key === step;
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1 sm:gap-2">
            <span
              className={cx(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                done ? 'bg-emerald-600 text-white' : active ? 'bg-brand-900 text-white ring-4 ring-brand-100 dark:bg-brand-500 dark:ring-brand-900' : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
              )}
            >
              {done ? <LuCheck className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cx('text-xs font-medium sm:text-sm', active ? 'text-slate-900 dark:text-white' : 'text-slate-500', !active && 'hidden md:inline')}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-4 bg-slate-300 sm:w-8 dark:bg-slate-700" />}
          </li>
        );
      })}
    </ol>
  );
}

function Nav({ back, next, nextLabel = 'Continue', nextDisabled, hint }: { back?: () => void; next?: () => void; nextLabel?: string; nextDisabled?: boolean; hint?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-col gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:rounded-xl sm:border dark:border-slate-800 dark:bg-slate-900/95">
      <div className="text-xs text-slate-500">{hint}</div>
      <div className="flex gap-2">
        {back && (
          <Button variant="secondary" icon={<LuArrowLeft className="h-4 w-4" />} onClick={back}>
            Back
          </Button>
        )}
        {next && (
          <Button onClick={next} disabled={nextDisabled} className="flex-1 sm:flex-none">
            {nextLabel} <LuArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ImportWizardPage({ clientId }: { clientId: string }) {
  const { data, backend, commitImport, saveMappingTemplate } = useStore();
  const { client, nodes, accounts, scope } = useClient(clientId);
  const { session } = useAuth();
  const toast = useToast();
  const base = `/c/${clientId}`;

  const [step, setStep] = useState<Step>('upload');
  const [wb, setWb] = useState<Workbook | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [extraSheets, setExtraSheets] = useState<number[]>([]);
  const [instFilter, setInstFilter] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [institution, setInstitution] = useState('');
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [usedTemplate, setUsedTemplate] = useState(false);
  const [rememberMapping, setRememberMapping] = useState(true);
  const [typeMap, setTypeMap] = useState<Record<string, string>>({});
  const [defaultType, setDefaultType] = useState('');
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
  const [filter, setFilter] = useState<'all' | 'dup' | 'new' | 'error'>('all');
  const [diffRow, setDiffRow] = useState<PlannedRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ record: ImportRecord; before: number; after: number; storedFile?: StoredFile; storeError?: string } | null>(null);

  const sheet = wb?.sheets[sheetIdx];
  const rows = sheet?.rows ?? [];
  const headers = rows[headerIndex] ?? [];
  const headerSig = headers.join('|');

  // Other sheets laid out with the same columns (e.g. one sheet per carrier) can be imported together.
  const compatibleSheets = useMemo(
    () =>
      (wb?.sheets ?? [])
        .map((s, i) => ({ s, i, h: detectHeaderRow(s.rows) }))
        .filter(({ s, i, h }) => i !== sheetIdx && s.rows.length > h + 1 && s.rows[h].join('|') === headerSig),
    [wb, sheetIdx, headerSig],
  );
  const planSheets = useMemo<PlanSheet[]>(() => {
    if (!sheet) return [];
    const extra = compatibleSheets.filter((c) => extraSheets.includes(c.i)).map((c) => ({ name: c.s.name, rows: c.s.rows, headerIndex: c.h }));
    return [{ name: sheet.name, rows, headerIndex }, ...extra];
  }, [sheet, rows, headerIndex, compatibleSheets, extraSheets]);

  const loadFile = async (f: File) => {
    setLoadError('');
    try {
      const book = await readSpreadsheet(f);
      const first = Math.max(0, book.sheets.findIndex((s) => s.rows.length > 1));
      if (!book.sheets.length || !book.sheets[first].rows.length) throw new Error('The file appears to be empty.');
      setWb(book);
      setFile(f);
      setExtraSheets([]);
      setInstFilter(null);
      setSheetIdx(first);
      setHeaderIndex(detectHeaderRow(book.sheets[first].rows));
      setInstitution((cur) => cur || guessInstitution(f.name, data.institutions));
      setOverrides({});
      setStep('preview');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  // File dropped on the dashboard
  useEffect(() => {
    const f = takePendingFile();
    if (f) loadFile(f);
  }, []);

  const goMap = () => {
    // Apply the saved mapping for this spreadsheet layout (same column headers); otherwise suggest.
    const tpl = data.mappingTemplates.find((t) => t.headers.join('|') === headerSig);
    if (tpl) {
      const m: Mapping = {};
      for (const [k, h] of Object.entries(tpl.mapping)) {
        const i = headers.indexOf(h as string);
        if (i >= 0) m[k as ImportField] = i;
      }
      setMapping(m);
      setUsedTemplate(true);
    } else {
      setMapping(suggestMapping(headers));
      setUsedTemplate(false);
    }
    setStep('map');
  };

  const goCategorize = () => {
    const raws = distinctRawTypes(planSheets, mapping);
    setTypeMap((prev) => ({ ...suggestTypeMap(raws, data.accountTypes), ...Object.fromEntries(Object.entries(prev).filter(([k]) => raws.includes(k))) }));
    setStep('categorize');
  };

  const plan = useMemo(
    () =>
      step === 'review' || step === 'categorize' || confirmOpen
        ? buildPlan({ sheets: planSheets, mapping, institution, institutions: data.institutions, typeMap, defaultType, defaultParentId, overrides, existing: accounts, nodes })
        : [],
    [step, planSheets, mapping, institution, data.institutions, typeMap, defaultType, defaultParentId, overrides, accounts, nodes, confirmOpen],
  );
  const summary = summarizePlan(plan);

  const setOverride = (key: string, o: RowOverride) => setOverrides((s) => ({ ...s, [key]: { ...s[key], ...o } }));
  const resolveAll = (r: Resolution) => {
    setOverrides((s) => {
      const next = { ...s };
      for (const p of plan) if (p.duplicates.length && p.include) next[p.key] = { ...next[p.key], resolution: r };
      return next;
    });
  };

  const projected = useMemo(() => {
    if (!confirmOpen) return null;
    const sim: Account[] = accounts.map((a) => ({ ...a }));
    for (const r of summary.toReplace) {
      const t = sim.find((a) => a.id === r.targetId);
      if (t) t.value = r.data.value;
    }
    for (const r of summary.toAdd) sim.push({ ...(r.data as Account), id: `sim${r.key}`, clientId, history: [], createdAt: '', source: { kind: 'manual' } });
    return {
      before: estateSummary(scope, data.accountTypes).total,
      after: estateSummary({ nodes, accounts: sim }, data.accountTypes).total,
    };
  }, [confirmOpen, accounts, summary.toAdd, summary.toReplace, scope, nodes, clientId, data.accountTypes]);

  const doImport = async () => {
    if (!client || !wb || !sheet) return;
    setImporting(true);
    const before = estateSummary(scope, data.accountTypes).total;
    const mapped = new Set(Object.values(mapping));
    const unmapped = headers.filter((h, i) => h && !mapped.has(i));
    const institutions = [...new Set(summary.included.map((r) => r.data.institution).filter(Boolean))];
    if (rememberMapping) {
      const byHeader: Partial<Record<ImportField, string>> = {};
      for (const [k, i] of Object.entries(mapping)) byHeader[k as ImportField] = headers[i as number];
      saveMappingTemplate({ institution: institutions.length === 1 ? institutions[0] : 'Multiple institutions', headers, mapping: byHeader });
    }
    // Keep the original spreadsheet in storage/clients/<estate>/uploads so every value can be traced back to it.
    let storedFile: StoredFile | undefined;
    let storeError: string | undefined;
    if (backend.mode === 'server' && file) {
      try {
        storedFile = await storeFile(file, { client: client.estateName, kind: 'uploads', name: wb.fileName });
      } catch (e) {
        storeError = e instanceof Error ? e.message : 'unknown error';
      }
    }
    const record = commitImport({
      clientId,
      fileName: wb.fileName,
      institution: institutions.length === 1 ? institutions[0] : `Multiple (${institutions.length})`,
      institutions,
      sheet: sheet.name,
      sheets: planSheets.map((p) => p.name),
      unmappedColumns: unmapped,
      importedBy: session?.email ?? 'unknown',
      storedFile,
      rows: summary.included.map((r) => ({ rowNumber: r.rowNumber, sheet: r.sheet, data: r.data, action: r.resolution === 'replace' ? 'replace' : r.resolution === 'keep' ? 'keep' : 'add', targetId: r.targetId })),
    });
    setImporting(false);
    setConfirmOpen(false);
    setResult({ record, before, after: projected?.after ?? before, storedFile, storeError });
    setStep('done');
    toast(`Imported ${record.accountsAdded + record.accountsReplaced} accounts from ${record.fileName}`);
  };

  if (!client) return null;

  // ---------- Step 1: Upload ----------
  if (step === 'upload') {
    return (
      <>
        <PageHeader eyebrow={client.estateName} title="Import Excel File" subtitle="Bring in account values from Schwab, Nationwide or any custodian export." back={{ to: base, label: 'Overview' }} />
        <Stepper step={step} />
        <div className="max-w-3xl">
          <Card title="1. Choose the file">
            <Field
              label="Financial institution"
              htmlFor="imp-inst"
              hint="Pick one for a single-custodian statement. For a file that lists several institutions, leave it on “Several” — each row’s institution is read from an institution column, section headings or sheet names."
              className="mb-4 max-w-md"
            >
              <InstitutionSelect id="imp-inst" value={institution} onChange={setInstitution} list={data.institutions} />
            </Field>
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) loadFile(f);
              }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-12 text-center hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
            >
              <LuUpload className="mb-3 h-8 w-8 text-brand-600 dark:text-brand-300" />
              <span className="font-medium">Drop your .xlsx or .csv file here</span>
              <span className="mt-1 text-sm text-slate-500">or click to browse</span>
              <input type="file" accept=".xlsx,.xlsm,.csv" className="hidden" data-testid="import-file" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
            </label>
            {loadError && (
              <Callout tone="error" className="mt-4" title="Could not read the file">
                {loadError}
              </Callout>
            )}
          </Card>
        </div>
      </>
    );
  }

  if (step === 'done' && result) {
    const r = result.record;
    return (
      <>
        <PageHeader eyebrow={client.estateName} title="Import complete" back={{ to: base, label: 'Overview' }} />
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <LuCircleCheck className="h-7 w-7" />
            </span>
            <p className="mt-4 font-display text-2xl font-semibold">{r.fileName}</p>
            <p className="text-sm text-slate-500">
              {r.accountsAdded} added · {r.accountsReplaced} replaced · {r.accountsSkipped} kept existing · {money(r.totalValue)} imported
            </p>
            {r.institutions && r.institutions.length > 1 && <p className="mt-1 text-xs text-slate-500">Institutions: {r.institutions.join(', ')}</p>}
            {result.storedFile && (
              <p className="mt-3 max-w-xl text-xs text-slate-500" data-testid="stored-upload">
                Original saved to <span className="font-mono break-all">storage/{result.storedFile.path}</span> ·{' '}
                <a className="text-brand-700 underline dark:text-brand-300" href={result.storedFile.url} target="_blank" rel="noopener">
                  open
                </a>
              </p>
            )}
            {result.storeError && (
              <Callout tone="warning" className="mt-3 text-left" title="The accounts were imported, but the original file wasn’t saved">
                {result.storeError}
              </Callout>
            )}
            <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
                <p className="text-xs text-slate-500">Estate total before</p>
                <p className="num text-lg font-semibold">{money(result.before)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-900/20">
                <p className="text-xs text-slate-500">Estate total now</p>
                <p className="num text-lg font-semibold text-emerald-700 dark:text-emerald-300" data-testid="total-after">
                  {money(result.after)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Change: {result.after - result.before >= 0 ? '+' : ''}
              {money(result.after - result.before)}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button href={base}>View updated estate</Button>
              <Button variant="secondary" href={`${base}/imports/${r.id}`}>
                Import details
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setWb(null);
                  setResult(null);
                  setInstitution('');
                  setStep('upload');
                }}
              >
                Import another file
              </Button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  if (!wb || !sheet) return null;
  const header = (
    <PageHeader
      eyebrow={client.estateName}
      title="Import Excel File"
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <LuFileSpreadsheet className="h-4 w-4 text-emerald-600" /> {wb.fileName} · {institution || 'Institutions from the file'}
        </span>
      }
      back={{ to: base, label: 'Overview' }}
    />
  );

  // ---------- Step 2: Preview ----------
  if (step === 'preview') {
    const previewRows = rows.slice(0, Math.max(headerIndex + 16, 16));
    const width = Math.max(...previewRows.map((r) => r.length), 1);
    const dataCount = rows.slice(headerIndex + 1).filter((r) => r.some((c) => c)).length;
    return (
      <>
        {header}
        <Stepper step={step} />
        <Card title="2. Preview the spreadsheet" subtitle="Check this is the right file and pick the row that holds the column headers.">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {wb.sheets.length > 1 && (
              <Field label="Sheet">
                <select
                  className="input"
                  value={sheetIdx}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setSheetIdx(i);
                    setExtraSheets([]);
                    setHeaderIndex(detectHeaderRow(wb.sheets[i].rows));
                  }}
                >
                  {wb.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name} ({s.rows.length} rows)
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Header row" hint="Detected automatically — change it if it’s wrong.">
              <select className="input" value={headerIndex} onChange={(e) => setHeaderIndex(Number(e.target.value))} data-testid="header-row">
                {rows.slice(0, 20).map((r, i) => (
                  <option key={i} value={i}>
                    Row {i + 1}: {r.filter(Boolean).slice(0, 3).join(', ').slice(0, 50) || '(empty)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Institution" htmlFor="prev-inst" hint="Leave on “Several” when the file covers more than one.">
              <InstitutionSelect id="prev-inst" value={institution} onChange={setInstitution} list={data.institutions} />
            </Field>
          </div>
          <div className="-mx-4 overflow-x-auto border-y border-slate-200 sm:-mx-5 dark:border-slate-800">
            <table className="w-full text-xs">
              <tbody>
                {previewRows.map((r, i) => (
                  <tr key={i} className={cx(i === headerIndex ? 'bg-brand-50 font-semibold text-brand-900 dark:bg-brand-900/40 dark:text-brand-100' : i < headerIndex ? 'text-slate-400' : '', 'border-b border-slate-100 dark:border-slate-800')}>
                    <td className="w-10 bg-slate-50 px-2 py-1.5 text-right text-slate-400 dark:bg-slate-800/40">{i + 1}</td>
                    {Array.from({ length: width }, (_, c) => (
                      <td key={c} className="max-w-48 truncate px-2 py-1.5 whitespace-nowrap">
                        {r[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {dataCount} data rows below the header · rows above the header, “Total” rows and institution headings (such as a row that just says “Pacific Life”) are handled automatically.
          </p>
          {compatibleSheets.length > 0 && (
            <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-900/20">
              <p className="text-sm font-medium">Other sheets in this workbook have the same columns</p>
              <p className="mb-2 text-xs text-slate-500">Include them to import every institution in one pass.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {compatibleSheets.map((c) => (
                  <label key={c.i} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={extraSheets.includes(c.i)}
                      onChange={(e) => setExtraSheets((x) => (e.target.checked ? [...x, c.i] : x.filter((i) => i !== c.i)))}
                    />
                    {c.s.name} <span className="text-xs text-slate-400">({c.s.rows.length - c.h - 1} rows)</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Nav back={() => setStep('upload')} next={goMap} nextDisabled={headers.filter(Boolean).length < 2} hint={headers.filter(Boolean).length < 2 ? 'Choose the row that holds the column headers.' : undefined} />
      </>
    );
  }

  // ---------- Step 3: Map columns ----------
  if (step === 'map') {
    const firstData = rows.slice(headerIndex + 1).find((r) => r.some((c) => c)) ?? [];
    const mappedCols = new Set(Object.values(mapping));
    const unmapped = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => h && !mappedCols.has(i));
    const missingRequired = mapping.value === undefined || (mapping.name === undefined && mapping.number === undefined);
    return (
      <>
        {header}
        <Stepper step={step} />
        {usedTemplate && (
          <Callout tone="success" className="mb-4" title="Using your saved mapping for this layout">
            Columns were matched the same way as the last file with these column headers. Review and adjust if needed.
          </Callout>
        )}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <Card title="3. Map spreadsheet columns to fields" subtitle="Suggested automatically from the column names. Every custodian’s layout is different.">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {IMPORT_FIELDS.map((f) => {
                const col = mapping[f.key];
                const required = f.key === 'value' || ((f.key === 'name' || f.key === 'number') && mapping.name === undefined && mapping.number === undefined);
                return (
                  <div key={f.key} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[200px_1fr_1fr] sm:items-center">
                    <div>
                      <p className="text-sm font-medium">
                        {f.label}
                        {(f.key === 'value' || f.key === 'name') && <span className="ml-0.5 text-red-600">*</span>}
                      </p>
                      {f.hint && <p className="text-[11px] text-slate-500">{f.hint}</p>}
                    </div>
                    <select
                      className={cx('input', required && col === undefined && 'border-red-400')}
                      value={col ?? ''}
                      aria-label={`Column for ${f.label}`}
                      data-field={f.key}
                      onChange={(e) => {
                        const v = e.target.value === '' ? undefined : Number(e.target.value);
                        setMapping((m) => {
                          const next: Mapping = { ...m };
                          // A column can only feed one field.
                          for (const k of Object.keys(next) as ImportField[]) if (next[k] === v) delete next[k];
                          if (v === undefined) delete next[f.key];
                          else next[f.key] = v;
                          return next;
                        });
                      }}
                    >
                      <option value="">— Not in this file —</option>
                      {headers.map((h, i) =>
                        h ? (
                          <option key={i} value={i}>
                            {h}
                          </option>
                        ) : null,
                      )}
                    </select>
                    <p className="truncate text-xs text-slate-500">{col !== undefined ? <>e.g. <span className="font-mono text-slate-700 dark:text-slate-300">{firstData[col] || '(blank)'}</span></> : ''}</p>
                  </div>
                );
              })}
            </div>
          </Card>
          <div className="min-w-0 space-y-5">
            <Card title="Spreadsheet columns">
              <ul className="space-y-1.5 text-sm">
                {headers.map((h, i) => {
                  if (!h) return null;
                  const field = IMPORT_FIELDS.find((f) => mapping[f.key] === i);
                  return (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate">{h}</span>
                      {field ? <Badge tone="green">→ {field.label}</Badge> : <Badge tone="amber">Not imported</Badge>}
                    </li>
                  );
                })}
              </ul>
            </Card>
            {unmapped.length > 0 && (
              <Callout tone="warning" title={`${unmapped.length} column${unmapped.length === 1 ? '' : 's'} will not be imported`}>
                {unmapped.map((u) => u.h).join(', ')}. This is recorded with the import.
              </Callout>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={rememberMapping} onChange={(e) => setRememberMapping(e.target.checked)} />
              <span>
                Remember this mapping for files with these columns
                <span className="block text-xs text-slate-500">Next month’s file will map itself.</span>
              </span>
            </label>
          </div>
        </div>
        {mapping.institution !== undefined ? (
          <Callout tone="info" className="mt-4" title={`Each row’s institution comes from “${headers[mapping.institution]}”`}>
            Names like “Jackson National Life” or “Equitable” are matched to your institution list automatically.
          </Callout>
        ) : !institution ? (
          <Callout tone="info" className="mt-4" title="Institutions will be detected from the file">
            Rows take their institution from section headings or sheet names. Any row without one is flagged in review, where you can pick it.
          </Callout>
        ) : null}
        <Nav back={() => setStep('preview')} next={goCategorize} nextDisabled={missingRequired} hint={missingRequired ? 'Map the value column and the account name or number.' : undefined} />
      </>
    );
  }

  // ---------- Step 4: Categorize ----------
  if (step === 'categorize') {
    const raws = Object.keys(typeMap);
    const noTypeRows = plan.filter((p) => !p.rawType || !typeMap[p.rawType]).length;
    return (
      <>
        {header}
        <Stepper step={step} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card title="4. Account categories" subtitle="How spreadsheet account types become app account types">
            {raws.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {raws.map((r) => (
                  <div key={r} className="grid grid-cols-2 items-center gap-3 py-2.5">
                    <span className="truncate text-sm">
                      “{r}” <span className="text-xs text-slate-400">({plan.filter((p) => p.rawType === r).length})</span>
                    </span>
                    <select className="input" value={typeMap[r]} onChange={(e) => setTypeMap((m) => ({ ...m, [r]: e.target.value }))} aria-label={`Account type for ${r}`}>
                      <option value="">Use default below</option>
                      {data.accountTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400">This file has no account type column, so every account uses the default category below.</p>
            )}
            <Field label="Default account type" className="mt-4" hint={`Used for ${noTypeRows} row${noTypeRows === 1 ? '' : 's'} without a recognized type. You can change any row in the next step.`}>
              <select className="input" value={defaultType} onChange={(e) => setDefaultType(e.target.value)} data-testid="default-type">
                <option value="">Select account type…</option>
                {data.accountTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </Card>
          <Card title="Where new accounts go" subtitle="Existing accounts you replace keep their current trust">
            <Field label="Default parent trust" hint="New accounts are placed here. Change individual rows in the next step.">
              <TrustSelect nodes={nodes} value={defaultParentId} onChange={setDefaultParentId} />
            </Field>
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/40">
              <p className="font-medium">{plan.length} accounts found</p>
              <p className="text-slate-500">
                {plan.filter((p) => p.duplicates.length).length} match accounts already in this estate · {plan.filter((p) => !p.duplicates.length).length} look new
              </p>
            </div>
          </Card>
        </div>
        <Nav back={() => setStep('map')} next={() => setStep('review')} nextDisabled={noTypeRows > 0 && !defaultType} hint={noTypeRows > 0 && !defaultType ? 'Choose a default account type.' : undefined} />
      </>
    );
  }

  // ---------- Step 5: Review ----------
  const byInst = institutionBreakdown(plan);
  const shown = plan
    .filter((p) => (filter === 'dup' ? p.duplicates.length > 0 : filter === 'new' ? p.duplicates.length === 0 && !p.errors.length : filter === 'error' ? p.errors.length > 0 : true))
    .filter((p) => !instFilter || (p.data.institution || '(none)') === instFilter);
  const dupCount = plan.filter((p) => p.duplicates.length).length;
  return (
    <>
      {header}
      <Stepper step={step} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase">Accounts to import</p>
          <p className="text-xl font-semibold" data-testid="review-count">
            {summary.toAdd.length + summary.toReplace.length}
          </p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase">Total value imported</p>
          <Money value={summary.importValue} className="text-xl font-semibold" />
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase">New</p>
          <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-400">{summary.toAdd.length}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-slate-500 uppercase">Replace / keep</p>
          <p className="text-xl font-semibold">
            {summary.toReplace.length} / {summary.toKeep.length}
          </p>
        </div>
        <div className={cx('card p-3', summary.unresolved.length > 0 && 'ring-2 ring-amber-400')}>
          <p className="text-[11px] text-slate-500 uppercase">Duplicates to decide</p>
          <p className="text-xl font-semibold text-amber-600">{summary.unresolved.length}</p>
        </div>
      </div>

      {summary.unresolved.length > 0 && (
        <Callout tone="warning" className="mb-4" title={`${summary.unresolved.length} possible duplicate account${summary.unresolved.length === 1 ? '' : 's'} — choose what to do`}>
          <p>Nothing is overwritten unless you choose “Replace existing”.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => resolveAll('replace')} data-testid="replace-all">
              Replace all with new values
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resolveAll('keep')}>
              Keep all existing
            </Button>
          </div>
        </Callout>
      )}

      {byInst.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {byInst.length === 1 ? 'Institution in this file' : `${byInst.length} institutions in this file`} · click to filter
          </p>
          <div className="flex flex-wrap gap-2" data-testid="institution-breakdown">
            {byInst.map((b) => (
              <button
                key={b.institution}
                onClick={() => setInstFilter((f) => (f === b.institution ? null : b.institution))}
                className={cx(
                  'cursor-pointer rounded-lg border px-3 py-1.5 text-left text-xs',
                  instFilter === b.institution ? 'border-brand-700 bg-brand-900 text-white dark:border-brand-400 dark:bg-brand-500' : 'border-slate-200 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900',
                  b.institution === '(none)' && instFilter !== b.institution && 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300',
                )}
              >
                <span className="block font-semibold">{b.institution === '(none)' ? 'No institution' : b.institution}</span>
                <span className="num opacity-80">
                  {b.count} acct{b.count === 1 ? '' : 's'} · {money(b.value)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2 dark:border-slate-800">
          {(
            [
              ['all', `All (${plan.length})`],
              ['dup', `Possible duplicates (${dupCount})`],
              ['new', `New (${plan.filter((p) => !p.duplicates.length && !p.errors.length).length})`],
              ['error', `Errors (${summary.errorRows.length})`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('shrink-0 cursor-pointer border-b-2 px-3 py-2 text-sm font-medium', filter === k ? 'border-gold-500 text-slate-900 dark:text-white' : 'border-transparent text-slate-500')}>
              {l}
            </button>
          ))}
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((p) => {
            const dup = p.duplicates.find((d) => d.account.id === p.targetId) ?? p.duplicates[0];
            return (
              <li key={p.key} className={cx('p-4', !p.include && 'bg-slate-50/70 dark:bg-slate-900/60')} data-testid={`row-${p.key}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                  <label className="flex min-w-0 flex-1 items-start gap-3">
                    <input type="checkbox" className="mt-1" checked={p.include} disabled={p.errors.length > 0} onChange={(e) => setOverride(p.key, { include: e.target.checked })} aria-label={`Include row ${p.rowNumber}`} />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={cx('font-medium', !p.include && 'text-slate-400 line-through')}>{p.data.name}</span>
                        <span className="font-mono text-xs text-slate-500">{p.data.number || 'no number'}</span>
                        {p.errors.length > 0 ? <Badge tone="red">Error</Badge> : p.duplicates.length ? <Badge tone="amber">Possible duplicate</Badge> : <Badge tone="green">New account</Badge>}
                        <span className="text-[11px] text-slate-400">
                          {planSheets.length > 1 ? `${p.sheet} · ` : ''}Row {p.rowNumber}
                        </span>
                      </span>
                      {p.errors.map((e) => (
                        <span key={e} className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <LuCircleAlert className="h-3.5 w-3.5" /> {e}
                        </span>
                      ))}
                      {p.warnings.map((w) => (
                        <span key={w} className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <LuTriangleAlert className="h-3.5 w-3.5" /> {w}
                        </span>
                      ))}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[680px]">
                    <select
                      className={cx('input h-9 py-1 text-xs', !p.data.institution && 'border-red-400')}
                      value={p.data.institution}
                      onChange={(e) => setOverride(p.key, { institution: e.target.value || undefined })}
                      aria-label="Institution"
                      title={p.institutionSource === 'column' ? `From the file: ${p.rawInstitution}` : p.institutionSource === 'section' ? 'From a section heading in the file' : p.institutionSource === 'sheet' ? 'From the sheet name' : undefined}
                    >
                      <option value="">Institution…</option>
                      {[...new Set([...data.institutions, ...(p.data.institution ? [p.data.institution] : [])])].map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                    <select className="input h-9 py-1 text-xs" value={p.data.type} onChange={(e) => setOverride(p.key, { type: e.target.value })} aria-label="Account type" disabled={p.resolution === 'replace' || p.resolution === 'keep'}>
                      <option value="">Type…</option>
                      {data.accountTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    <select className="input h-9 py-1 text-xs" value={p.data.parentId ?? ''} onChange={(e) => setOverride(p.key, { parentId: e.target.value || null })} aria-label="Parent trust" disabled={p.resolution === 'replace' || p.resolution === 'keep'}>
                      <option value="">Estate (no trust)</option>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                    {p.errors.some((e) => e.includes('value') || e.includes('Value')) ? (
                      <input className="input h-9 py-1 text-right text-xs" placeholder="Correct value" defaultValue="" onBlur={(e) => e.target.value && setOverride(p.key, { value: e.target.value })} aria-label="Corrected value" />
                    ) : (
                      <span className="col-span-2 flex items-center justify-end sm:col-span-1">
                        <Money value={p.data.value} cents className="text-sm font-semibold" />
                      </span>
                    )}
                  </div>
                </div>

                {p.duplicates.length > 0 && p.include && dup && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 sm:ml-7 dark:border-amber-800 dark:bg-amber-900/10">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                      <LuCopy className="h-4 w-4" /> Possible Duplicate Account <span className="font-normal text-amber-700 dark:text-amber-300">· {dup.reasons.join(', ').toLowerCase()}</span>
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <div className="rounded-lg bg-white p-2.5 dark:bg-slate-900">
                        <p className="text-slate-500">Existing account</p>
                        <p className="font-medium">
                          {dup.account.institution} · {dup.account.name} {maskNumber(dup.account.number)}
                        </p>
                        <p className="num">
                          {money(dup.account.value, true)} <span className="text-slate-400">as of {dup.account.lastUpdated}</span>
                        </p>
                      </div>
                      <div className="rounded-lg bg-white p-2.5 dark:bg-slate-900">
                        <p className="text-slate-500">Imported account</p>
                        <p className="font-medium">
                          {p.data.institution} · {p.data.name} {maskNumber(p.data.number)}
                        </p>
                        <p className="num">
                          {money(p.data.value, true)} <span className="text-slate-400">as of {p.data.lastUpdated}</span>
                          {dup.account.value !== null && p.data.value !== null && (
                            <span className={cx('ml-1 font-medium', p.data.value - dup.account.value >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                              ({p.data.value - dup.account.value >= 0 ? '+' : ''}
                              {money(p.data.value - dup.account.value, true)})
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    {p.duplicates.length > 1 && (
                      <select className="input mt-2 h-8 py-1 text-xs" value={p.targetId} onChange={(e) => setOverride(p.key, { targetId: e.target.value })} aria-label="Matching account">
                        {p.duplicates.map((d) => (
                          <option key={d.account.id} value={d.account.id}>
                            Match: {d.account.name} {maskNumber(d.account.number)} ({money(d.account.value)})
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Duplicate resolution">
                      {(
                        [
                          ['keep', 'Keep existing account'],
                          ['replace', 'Replace existing account'],
                          ['new', 'Create new account'],
                        ] as const
                      ).map(([k, l]) => (
                        <button
                          key={k}
                          role="radio"
                          aria-checked={p.resolution === k}
                          onClick={() => setOverride(p.key, { resolution: k })}
                          className={cx(
                            'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium',
                            p.resolution === k ? 'border-brand-700 bg-brand-900 text-white dark:border-brand-400 dark:bg-brand-500' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
                          )}
                        >
                          {l}
                        </button>
                      ))}
                      <button onClick={() => setDiffRow(p)} className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30">
                        <LuGitCompare className="h-3.5 w-3.5" /> Review differences
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="p-8 text-center text-sm text-slate-500">Nothing in this view.</li>}
        </ul>
      </div>

      <Nav
        back={() => setStep('categorize')}
        next={() => setConfirmOpen(true)}
        nextLabel="Confirm import"
        nextDisabled={summary.unresolved.length > 0 || summary.toAdd.length + summary.toReplace.length === 0}
        hint={
          summary.unresolved.length > 0
            ? `Decide on ${summary.unresolved.length} possible duplicate${summary.unresolved.length === 1 ? '' : 's'} to continue.`
            : `${summary.toAdd.length + summary.toReplace.length} accounts · ${money(summary.importValue)}${summary.errorRows.length ? ` · ${summary.errorRows.filter((r) => !r.include).length} rows with errors skipped` : ''}`
        }
      />

      <Modal open={!!diffRow} onClose={() => setDiffRow(null)} title="Review differences" size="lg">
        {diffRow &&
          (() => {
            const existing = accounts.find((a) => a.id === (diffRow.targetId ?? diffRow.duplicates[0]?.account.id));
            if (!existing) return null;
            const d = diffFields(existing, diffRow.data);
            return (
              <>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-2">Field</th>
                      <th className="py-2">Existing</th>
                      <th className="py-2">From {wb.fileName}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {d.map((r) => (
                      <tr key={r.field} className={r.changes ? 'bg-amber-50 dark:bg-amber-900/10' : ''}>
                        <td className="py-2 pr-2 text-slate-500">{r.field}</td>
                        <td className="num py-2 pr-2">{r.before}</td>
                        <td className={cx('num py-2', r.changes && 'font-semibold')}>
                          {r.after}
                          {r.changes && <Badge tone="amber" className="ml-2">will change</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-slate-500">“Replace existing” updates the highlighted values and records the file as the source. The account’s name, number, trust, type and notes stay as they are. The old value is kept in its history.</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {(['keep', 'replace', 'new'] as const).map((k) => (
                    <Button
                      key={k}
                      variant={k === 'replace' ? 'primary' : 'secondary'}
                      onClick={() => {
                        setOverride(diffRow.key, { resolution: k, targetId: existing.id });
                        setDiffRow(null);
                      }}
                    >
                      {k === 'keep' ? 'Keep existing' : k === 'replace' ? 'Replace existing' : 'Create new account'}
                    </Button>
                  ))}
                </div>
              </>
            );
          })()}
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm import"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Go back
            </Button>
            <Button onClick={doImport} disabled={importing} data-testid="confirm-import">
              {importing ? 'Importing…' : `Import ${summary.toAdd.length + summary.toReplace.length} accounts`}
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
            <span>New accounts to add</span>
            <b>
              {summary.toAdd.length} · {money(summary.toAdd.reduce((s, r) => s + (r.data.value ?? 0), 0))}
            </b>
          </li>
          <li className="flex justify-between">
            <span>Existing accounts to replace</span>
            <b>
              {summary.toReplace.length} · {money(summary.toReplace.reduce((s, r) => s + (r.data.value ?? 0), 0))}
            </b>
          </li>
          <li className="flex justify-between">
            <span>Duplicates kept unchanged</span>
            <b>{summary.toKeep.length}</b>
          </li>
          <li className="flex justify-between text-slate-500">
            <span>Rows skipped (excluded or errors)</span>
            <b>{plan.length - summary.included.length}</b>
          </li>
        </ul>
        {projected && (
          <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
            <div className="flex justify-between text-sm">
              <span>Estate total now</span>
              <span className="num">{money(projected.before)}</span>
            </div>
            <div className="mt-1 flex justify-between text-sm font-semibold">
              <span>Estate total after import</span>
              <span className="num">{money(projected.after)}</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>Change</span>
              <span className="num">
                {projected.after - projected.before >= 0 ? '+' : ''}
                {money(projected.after - projected.before)}
              </span>
            </div>
          </div>
        )}
        {summary.toReplace.length > 0 && (
          <Callout tone="warning" className="mt-4">
            {summary.toReplace.length} existing account value{summary.toReplace.length === 1 ? '' : 's'} will be replaced. Previous values stay in each account’s history.
          </Callout>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Source recorded as <b>{wb.fileName}</b>
          {planSheets.length > 1 ? `, sheets ${planSheets.map((x) => `“${x.name}”`).join(', ')}` : `, sheet “${sheet.name}”`}, with each account’s own institution (
          {institutionBreakdown(summary.included).map((b) => b.institution).join(', ')}).
          {backend.mode === 'server' ? ' The original file is saved in the client’s uploads folder.' : ''}
        </p>
      </Modal>
    </>
  );
}
