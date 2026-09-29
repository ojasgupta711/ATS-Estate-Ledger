import { useEffect, useRef, useState } from 'react';
import { LuLoader } from 'react-icons/lu';
// PDF.js "legacy" build: includes polyfills so it runs in older browsers too.
// The worker is bundled as a separate file; Vite gives us its URL.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// Renders a PDF's pages as images using PDF.js, so the preview works in every browser —
// including ones set to "always download PDFs" or without a built-in PDF viewer.

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
  return pdfjsPromise;
}

export function PdfPages({ bytes, className }: { bytes: Uint8Array; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; pages: number; error?: string }>({ status: 'loading', pages: 0 });

  useEffect(() => {
    let cancelled = false;
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    setState({ status: 'loading', pages: 0 });

    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        // PDF.js takes ownership of the buffer it is given, so pass a copy.
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const width = Math.max(320, el.clientWidth || 800);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block rounded-sm bg-white shadow-md ring-1 ring-slate-300 dark:ring-slate-700';
          canvas.setAttribute('aria-label', `Page ${i} of ${doc.numPages}`);
          canvas.setAttribute('role', 'img');
          const ctx = canvas.getContext('2d')!;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          const wrap = document.createElement('figure');
          wrap.className = 'm-0';
          const cap = document.createElement('figcaption');
          cap.className = 'mt-1.5 text-center text-[11px] text-slate-500';
          cap.textContent = `Page ${i} of ${doc.numPages}`;
          wrap.append(canvas, cap);
          el.append(wrap);
        }
        if (!cancelled) setState({ status: 'ready', pages: doc.numPages });
        doc.destroy();
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ status: 'error', pages: 0, error: e instanceof Error ? e.message : 'Could not display the PDF' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  return (
    <div className={className}>
      {state.status === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <LuLoader className="h-4 w-4 animate-spin" /> Rendering preview…
        </div>
      )}
      {state.status === 'error' && <p className="py-10 text-center text-sm text-red-600">The preview couldn’t be shown ({state.error}). Use Open or Download instead.</p>}
      <div ref={host} className="space-y-5" data-testid="pdf-pages" data-pages={state.pages} />
    </div>
  );
}
