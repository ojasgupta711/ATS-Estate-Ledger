import { useCallback, useEffect, useRef, useState } from 'react';
import { LuDownload, LuExternalLink, LuEye, LuFileText, LuFolderOpen, LuLoader, LuRefreshCw } from 'react-icons/lu';
import { PdfPages } from '../components/PdfPages';
import { Badge, Button, Callout, Card, Field, Modal, PageHeader, useToast } from '../components/ui';
import { childAccounts, childNodes, estateSummary, nodeSelfExcluded, nodeTotals, type EstateScope } from '../lib/calc';
import { downloadUrl, listFiles, storeFile, type ListedFile } from '../lib/api';
import { fmtDateTime, money, todayIso } from '../lib/format';
import { buildEstatePdf, defaultReportOptions, type ReportOptions } from '../lib/pdf';
import { qualityIssues } from '../lib/quality';
import { useClient, useStore } from '../state/store';
import { NODE_COLORS, type Account, type EstateNode } from '../types';

function PreviewSection({ node, scope, depthLabel }: { node: EstateNode; scope: EstateScope; depthLabel?: string }) {
  const t = nodeTotals(scope, node.id);
  const accts = childAccounts(scope, node.id);
  const kids = childNodes(scope, node.id);
  return (
    <>
      <div className="mb-4 break-inside-avoid">
        {depthLabel && <p className="mb-0.5 text-[10px] text-slate-500 italic">{depthLabel}</p>}
        <div className="flex items-stretch border-b-2 border-brand-800 text-slate-900">
          <div className="min-w-0 flex-1 truncate px-2 py-1 text-center text-sm font-semibold" style={{ background: NODE_COLORS[node.color].hex }}>
            {node.name}
          </div>
          <div className="num flex w-28 justify-between bg-slate-200 px-2 py-1 text-sm font-semibold">
            <span>$</span>
            <span>{!accts.length && !kids.length ? '0' : t.direct ? t.direct.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</span>
          </div>
        </div>
        {nodeSelfExcluded(node) && <p className="text-[10px] text-violet-600 italic">Shown for reference — not included in the estate total</p>}
        {accts.map((a) => (
          <div key={a.id} className="flex justify-between border-b border-slate-200 px-1 py-0.5 text-xs dark:border-slate-700">
            <span className="min-w-0 truncate font-medium">
              {a.name}
              {a.number && ` - ${a.number.replace(/\D/g, '').slice(-4)}`}
            </span>
            <span className="num">{a.value ? money(a.value) : '$ -'}</span>
          </div>
        ))}
        {node.distributionInfo && <p className="mt-1 text-[10px] whitespace-pre-line text-slate-600 dark:text-slate-400">{node.distributionInfo}</p>}
      </div>
      {kids.map((k) => (
        <PreviewSection key={k.id} node={k} scope={scope} depthLabel={`Created under ${node.name}`} />
      ))}
    </>
  );
}

/** Accounts not assigned to any trust — the PDF shows them as "Other Accounts". */
function PreviewOther({ accounts }: { accounts: Account[] }) {
  if (!accounts.length) return null;
  const total = accounts.reduce((s, a) => s + (a.value ?? 0), 0);
  return (
    <div className="mb-4 break-inside-avoid">
      <div className="flex items-stretch border-b-2 border-brand-800 text-slate-900">
        <div className="min-w-0 flex-1 truncate px-2 py-1 text-center text-sm font-semibold" style={{ background: NODE_COLORS.rose.hex }}>
          Other Accounts
        </div>
        <div className="num flex w-28 justify-between bg-slate-200 px-2 py-1 text-sm font-semibold">
          <span>$</span>
          <span>{total ? total.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '-'}</span>
        </div>
      </div>
      {accounts.map((a) => (
        <div key={a.id} className="flex justify-between border-b border-slate-200 px-1 py-0.5 text-xs dark:border-slate-700">
          <span className="min-w-0 truncate font-medium">
            {a.name}
            {a.number && ` - ${a.number.replace(/\D/g, '').slice(-4)}`}
          </span>
          <span className="num">{a.value ? money(a.value) : '$ -'}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportPage({ clientId }: { clientId: string }) {
  const { data, backend, logActivity } = useStore();
  const { client, scope, accounts, nodes, imports } = useClient(clientId);
  const toast = useToast();
  const [opts, setOpts] = useState<ReportOptions>(() => defaultReportOptions(todayIso(), data.settings.internalUseLabel));
  // The generated PDF: a file saved by the server (normal URL), or an in-browser copy (blob URL) when the server isn't running.
  const [pdf, setPdf] = useState<{ url: string; bytes: Uint8Array; stored?: { path: string } } | null>(null);
  // Every time a PDF is generated it opens in a review window before downloading.
  const [reviewOpen, setReviewOpen] = useState(false);
  const url = pdf?.url ?? null;
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState<ListedFile[]>([]);
  const blobRef = useRef<string | null>(null);

  const refreshSaved = useCallback(() => {
    if (backend.mode === 'server' && client) listFiles(client.estateName, 'reports').then(setSaved);
  }, [backend.mode, client]);
  useEffect(refreshSaved, [refreshSaved]);
  // Release the in-browser copy only when leaving the page.
  useEffect(() => () => void (blobRef.current && URL.revokeObjectURL(blobRef.current)), []);

  useEffect(() => {
    if (url) setStale(true);
  }, [opts, data]);

  if (!client) return null;
  const s = estateSummary(scope, data.accountTypes);
  const errors = qualityIssues(accounts, nodes, imports, data.accountTypes).filter((i) => i.severity === 'error');
  const fileName = `${client.estateName} Summary ${opts.reportDate}.pdf`;
  const set = <K extends keyof ReportOptions>(k: K, v: ReportOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const generate = async () => {
    setBusy(true);
    try {
      const bytes = await buildEstatePdf(data, client, opts);
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      let savedToServer = false;
      if (backend.mode === 'server') {
        try {
          const f = await storeFile(blob, { client: client.estateName, kind: 'reports', name: fileName });
          // Cache-bust so the preview shows the newest version of a report with the same name.
          setPdf({ url: `${f.url}?v=${Date.now()}`, bytes, stored: f });
          savedToServer = true;
          refreshSaved();
          toast(`Saved to storage/${f.path}`);
        } catch (e) {
          toast(`Couldn’t save to the storage folder (${e instanceof Error ? e.message : 'error'}). Showing an in-browser copy.`, 'error');
        }
      }
      if (!savedToServer) {
        if (blobRef.current) URL.revokeObjectURL(blobRef.current);
        blobRef.current = URL.createObjectURL(blob);
        setPdf({ url: blobRef.current, bytes });
        toast('Estate summary PDF is ready');
      }
      setStale(false);
      setReviewOpen(true);
      logActivity({ clientId, kind: 'report', summary: `Generated ${fileName} — total ${money(s.total)}` });
    } catch (e) {
      console.error(e);
      toast('Could not generate the PDF', 'error');
    } finally {
      setBusy(false);
    }
  };

  const linkBtn = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';
  const primaryLink = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-800 dark:bg-brand-500 dark:hover:bg-brand-400';
  const dlHref = url ? (pdf?.stored ? downloadUrl(url) : url) : '';

  const tops = childNodes(scope, null);
  const left = tops.filter((n, i) => n.reportColumn === 'left' || (n.reportColumn === 'auto' && i % 2 === 0));
  const right = tops.filter((n) => !left.includes(n));
  const unassigned = childAccounts(scope, null);

  return (
    <>
      <PageHeader eyebrow={client.estateName} title="Estate Summary PDF" subtitle="A client-ready report generated from the current accounts, trusts and totals." back={{ to: `/c/${clientId}`, label: 'Overview' }} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_1fr]">
        <div className="min-w-0 space-y-5">
          <Card title="Report options">
            <div className="space-y-4">
              <Field label="Report date">
                <input type="date" className="input" value={opts.reportDate} onChange={(e) => set('reportDate', e.target.value)} />
              </Field>
              <Field label="Account numbers">
                <select className="input" value={opts.accountNumbers} onChange={(e) => set('accountNumbers', e.target.value as ReportOptions['accountNumbers'])}>
                  <option value="last4">Last 4 digits (recommended)</option>
                  <option value="full">Full number</option>
                  <option value="hidden">Hide</option>
                </select>
              </Field>
              {(
                [
                  ['internalUse', '“Internal Use Only” label'],
                  ['includeDistributions', 'Distribution information'],
                  ['includeNotes', 'Notes'],
                  ['includeCrtSchedule', 'CRT payout schedules'],
                  ['includeAppendix', 'Account detail & sources page'],
                  ['fitOnePage', 'Fit summary on one page'],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={opts[k]} onChange={(e) => set(k, e.target.checked)} />
                  {l}
                </label>
              ))}
            </div>
          </Card>
          {unassigned.length > 0 && (
            <Callout tone="info" title={`${unassigned.length} account${unassigned.length === 1 ? ' isn’t' : 's aren’t'} in a trust`}>
              {unassigned.length === 1 ? 'It' : 'They'} will appear in an “Other Accounts” section of the report and {unassigned.length === 1 ? 'is' : 'are'} included in the total. You can still generate the PDF.
            </Callout>
          )}
          {errors.length > 0 && (
            <Callout tone="error" title={`${errors.length} data error${errors.length === 1 ? '' : 's'}`}>
              Fix these before sharing the report. <a className="underline" href={`#/c/${clientId}/quality`}>Review data quality</a>
            </Callout>
          )}
          <Card>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Total estate value</span>
                <b className="num">{money(s.total)}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sections</span>
                <b>{nodes.length + (unassigned.length ? 1 : 0)}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Accounts</span>
                <b>{s.accountCount}</b>
              </div>
            </div>
            <Button className="mt-4 w-full" size="lg" onClick={generate} disabled={busy} icon={busy ? <LuLoader className="h-4 w-4 animate-spin" /> : url && stale ? <LuRefreshCw className="h-4 w-4" /> : <LuFileText className="h-4 w-4" />} data-testid="generate-pdf">
              {busy ? 'Generating…' : url && stale ? 'Regenerate PDF' : 'Generate Estate Summary PDF'}
            </Button>
            {url && (
              <>
                <Button variant="secondary" className="mt-2 w-full" icon={<LuEye className="h-4 w-4" />} onClick={() => setReviewOpen(true)} data-testid="pdf-review">
                  Review PDF
                </Button>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <a className={linkBtn} href={dlHref} download={fileName} data-testid="pdf-download">
                    <LuDownload className="h-4 w-4" /> Download
                  </a>
                  <a className={linkBtn} href={url} target="_blank" rel="noopener" data-testid="pdf-open">
                    <LuExternalLink className="h-4 w-4" /> Open
                  </a>
                </div>
                {pdf?.stored && (
                  <p className="mt-3 text-xs text-slate-500" data-testid="pdf-saved-path">
                    Saved to <span className="font-mono break-all">storage/{pdf.stored.path}</span>
                  </p>
                )}
              </>
            )}
            {backend.mode === 'browser' && (
              <p className="mt-3 text-xs text-slate-500">The server isn’t running, so the PDF stays in this browser. Start the app with “npm run dev” to save reports to the storage folder.</p>
            )}
          </Card>
          {backend.mode === 'server' && saved.length > 0 && (
            <Card title="Saved reports" subtitle={`storage/clients/${client.estateName}/reports`} icon={<LuFolderOpen className="h-4 w-4" />} bodyClassName="p-0">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {saved.slice(0, 8).map((f) => (
                  <li key={f.path} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <a className="block truncate font-medium hover:underline" href={f.url} target="_blank" rel="noopener">
                        {f.name}
                      </a>
                      <span className="text-xs text-slate-500">{fmtDateTime(f.savedAt)}</span>
                    </span>
                    <a className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800" href={downloadUrl(f.url)} download={f.name} aria-label={`Download ${f.name}`} title="Download">
                      <LuDownload className="h-4 w-4" />
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div>
          {url ? (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-sm dark:border-slate-800">
                <span className="truncate font-medium">{fileName}</span>
                {stale ? <Badge tone="amber">Data changed — regenerate</Badge> : <Badge tone="green">Up to date</Badge>}
              </div>
              <div className="max-h-[80vh] overflow-y-auto bg-slate-100 p-4 dark:bg-slate-950">
                <PdfPages bytes={pdf!.bytes} />
              </div>
            </div>
          ) : (
            <div className="card p-4 sm:p-6">
              <p className="mb-4 text-xs font-medium tracking-wide text-slate-500 uppercase">Preview</p>
              <div className="rounded-lg bg-white p-4 text-slate-900 shadow-inner ring-1 ring-slate-200 sm:p-6 dark:ring-slate-700">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-brand-800 pb-2">
                  <div>
                    <p className="font-display text-2xl font-bold text-maroon-600">{data.settings.firmName}</p>
                    <p className="text-[9px] tracking-widest text-maroon-600 uppercase">{data.settings.firmTagline}</p>
                  </div>
                  <p className="text-lg font-semibold text-brand-800">{client.estateName} Summary</p>
                  {opts.internalUse && <span className="bg-yellow-300 px-2 text-[10px] font-semibold text-red-700">Internal Use Only {opts.reportDate}</span>}
                </div>
                <div className="my-3 flex justify-end">
                  <span className="mr-3 self-center text-sm font-semibold">Total</span>
                  <span className="num bg-yellow-300 px-3 py-0.5 font-bold">{money(s.total)}</span>
                </div>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div className="min-w-0">
                    {left.map((n) => (
                      <PreviewSection key={n.id} node={n} scope={scope} />
                    ))}
                  </div>
                  <div className="min-w-0">
                    {right.map((n) => (
                      <PreviewSection key={n.id} node={n} scope={scope} />
                    ))}
                    <PreviewOther accounts={unassigned} />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">Click “Generate Estate Summary PDF” for the formatted report.</p>
            </div>
          )}
        </div>
      </div>
      <Modal
        open={reviewOpen && !!pdf}
        onClose={() => setReviewOpen(false)}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Review before downloading <span className="text-sm font-normal text-slate-500">{fileName}</span>
          </span>
        }
        size="full"
        footer={
          pdf && (
            <>
              <Button variant="secondary" onClick={() => setReviewOpen(false)}>
                Close
              </Button>
              <a className={linkBtn} href={url!} target="_blank" rel="noopener">
                <LuExternalLink className="h-4 w-4" /> Open in new tab
              </a>
              <a className={primaryLink} href={dlHref} download={fileName} data-testid="review-download">
                <LuDownload className="h-4 w-4" /> Download PDF
              </a>
            </>
          )
        }
      >
        <div className="-mx-5 -my-4 bg-slate-100 px-4 py-5 sm:px-8 dark:bg-slate-950" data-testid="pdf-review-modal">
          {pdf && <PdfPages bytes={pdf.bytes} className="mx-auto max-w-4xl" />}
        </div>
      </Modal>
    </>
  );
}
