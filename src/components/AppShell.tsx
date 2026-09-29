import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LuChartPie,
  LuChevronDown,
  LuFileText,
  LuFileUp,
  LuFolderTree,
  LuHistory,
  LuLandmark,
  LuLayoutDashboard,
  LuLogOut,
  LuMonitor,
  LuMoon,
  LuPlus,
  LuSettings,
  LuSun,
  LuTriangleAlert,
  LuUsers,
  LuWallet,
  LuScale,
} from 'react-icons/lu';
import { cx } from '../lib/format';
import { qualityIssues } from '../lib/quality';
import { navigate } from '../lib/router';
import { useAuth } from '../state/auth';
import { useClient, useStore } from '../state/store';
import { useTheme, type ThemePref } from '../state/theme';
import { Button } from './ui';
import { sortClients } from '../lib/clients';
import { ATS_LOGO_DATA_URL } from '../data/logo';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <a href="#/clients" className="flex items-center gap-2.5">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white p-1 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
        <img src={ATS_LOGO_DATA_URL} alt="ATS" className="h-full w-full object-contain" />
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-display text-[15px] font-semibold text-brand-900 dark:text-white">ATS Estate Ledger</span>
          <span className="block text-[10px] font-medium tracking-[0.14em] text-maroon-600 uppercase dark:text-maroon-400">Advanced Trustee Strategies</span>
        </span>
      )}
    </a>
  );
}

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const opts: { v: ThemePref; icon: ReactNode; label: string }[] = [
    { v: 'light', icon: <LuSun className="h-4 w-4" />, label: 'Light' },
    { v: 'dark', icon: <LuMoon className="h-4 w-4" />, label: 'Dark' },
    { v: 'system', icon: <LuMonitor className="h-4 w-4" />, label: 'System' },
  ];
  return (
    <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.v}
          role="radio"
          aria-checked={pref === o.v}
          title={`${o.label} mode`}
          aria-label={`${o.label} mode`}
          onClick={() => setPref(o.v)}
          className={cx(
            'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors',
            pref === o.v ? 'bg-white text-brand-900 shadow-sm dark:bg-slate-600 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white',
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut();
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [onOut]);
  return ref;
}

function ClientSwitcher({ clientId }: { clientId?: string }) {
  const { data } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const client = data.clients.find((c) => c.id === clientId);
  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[52vw] min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm hover:border-slate-300 sm:max-w-xs dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <LuUsers className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="truncate font-medium">{client ? client.estateName : 'Select a client'}</span>
        <LuChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="max-h-72 overflow-y-auto py-1">
            {sortClients(data.clients).map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setOpen(false);
                  navigate(`/c/${c.id}`);
                }}
                className={cx('block w-full cursor-pointer px-4 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800', c.id === clientId && 'bg-brand-50 dark:bg-brand-900/40')}
              >
                <span className="block font-medium">{c.estateName}</span>
                <span className="block text-xs text-slate-500">{c.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-slate-100 p-2 dark:border-slate-800">
            <button
              onClick={() => {
                setOpen(false);
                navigate('/clients?new=1');
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/40"
            >
              <LuPlus className="h-4 w-4" /> New client
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  if (!session) return null;
  const initials = session.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-gold-100 text-xs font-semibold text-gold-700 ring-1 ring-gold-300 dark:bg-gold-700/30 dark:text-gold-300" aria-label="Account menu">
        {initials || 'U'}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="text-sm font-medium">{session.name}</p>
            <p className="truncate text-xs text-slate-500">{session.email}</p>
            <p className="mt-1 text-[11px] text-slate-400">Signed in with {session.provider === 'google' ? 'Google' : 'email & password'}</p>
          </div>
          <div className="p-3 sm:hidden">
            <p className="label">Theme</p>
            <ThemeToggle />
          </div>
          <div className="p-1">
            <a href="#/clients" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <LuUsers className="h-4 w-4" /> All clients
            </a>
            <a href="#/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <LuSettings className="h-4 w-4" /> Settings
            </a>
            <button
              onClick={() => {
                signOut();
                navigate('/login');
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <LuLogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const SECTIONS = [
  { key: '', label: 'Overview', icon: LuLayoutDashboard },
  { key: 'summary', label: 'Summary', icon: LuScale },
  { key: 'trusts', label: 'Trusts', icon: LuLandmark },
  { key: 'breakdown', label: 'By Type', icon: LuChartPie },
  { key: 'hierarchy', label: 'Hierarchy', icon: LuFolderTree },
  { key: 'accounts', label: 'Accounts', icon: LuWallet },
  { key: 'import', label: 'Import', icon: LuFileUp },
  { key: 'imports', label: 'Changes/Import History', icon: LuHistory },
  { key: 'quality', label: 'Data Quality', icon: LuTriangleAlert },
  { key: 'report', label: 'PDF Report', icon: LuFileText },
] as const;

function SectionNav({ clientId, active }: { clientId: string; active: string }) {
  const { data } = useStore();
  const { accounts, nodes, imports } = useClient(clientId);
  const issues = qualityIssues(accounts, nodes, imports, data.accountTypes).filter((i) => i.severity !== 'info').length;
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active]);
  return (
    <nav ref={navRef} className="scrollbar-none -mb-px flex gap-1 overflow-x-auto" aria-label="Estate sections">
      {SECTIONS.map((s) => {
        const isActive = active === s.key;
        const Icon = s.icon;
        return (
          <a
            key={s.key}
            href={`#/c/${clientId}${s.key ? `/${s.key}` : ''}`}
            aria-current={isActive ? 'page' : undefined}
            className={cx(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'border-gold-500 text-brand-900 dark:border-gold-300 dark:text-white'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200',
            )}
          >
            <Icon className="h-4 w-4" />
            {s.label}
            {s.key === 'quality' && issues > 0 && <span className="ml-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">{issues}</span>}
          </a>
        );
      })}
    </nav>
  );
}

function SyncBanner() {
  const { syncNotice, dismissSyncNotice } = useStore();
  if (!syncNotice) return null;
  return (
    <div className={cx('mb-5 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm ring-1 ring-inset', syncNotice.tone === 'warning' ? 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-100 dark:ring-amber-800' : 'bg-brand-50 text-brand-900 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-100 dark:ring-brand-800')} role="status" data-testid="sync-notice">
      <span>{syncNotice.text}</span>
      <button className="shrink-0 cursor-pointer text-xs font-medium underline" onClick={dismissSyncNotice}>
        Dismiss
      </button>
    </div>
  );
}

function StorageFooter() {
  const { backend, saveStatus } = useStore();
  return (
    <footer className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-10 text-xs text-slate-400 sm:px-6">
      <span>ATS Estate Ledger · v0.4</span>
      {backend.mode === 'server' ? (
        <span className="flex items-center gap-1.5" data-testid="storage-status">
          <span className={cx('h-2 w-2 rounded-full', saveStatus.state === 'error' ? 'bg-red-500' : saveStatus.state === 'saving' ? 'bg-amber-400' : 'bg-emerald-500')} />
          {saveStatus.state === 'error' ? `Not saved — ${saveStatus.error}. Is the server still running?` : saveStatus.state === 'saving' ? 'Saving…' : 'Saved to'}{' '}
          {saveStatus.state !== 'error' && saveStatus.state !== 'saving' && <span className="font-mono break-all">{backend.storage}</span>}
        </span>
      ) : (
        <span data-testid="storage-status">Server not running — data is stored in this browser only.</span>
      )}
    </footer>
  );
}

export function AppShell({ clientId, section, children }: { clientId?: string; section?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="hidden md:block">
            <Logo />
          </div>
          <div className="md:hidden">
            <Logo compact />
          </div>
          <div className="mx-1 hidden h-6 w-px bg-slate-200 md:block dark:bg-slate-700" />
          <ClientSwitcher clientId={clientId} />
          <div className="ml-auto flex items-center gap-2">
            {clientId && (
              <Button size="sm" variant="gold" icon={<LuPlus className="h-4 w-4" />} href={`/c/${clientId}/accounts/new`} className="hidden sm:inline-flex">
                Add Account
              </Button>
            )}
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <UserMenu />
          </div>
        </div>
        {clientId && (
          <div className="mx-auto max-w-7xl px-2 sm:px-4">
            <SectionNav clientId={clientId} active={section ?? ''} />
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <SyncBanner />
        {children}
      </main>
      {clientId && section !== 'import' && (
        <a
          href={`#/c/${clientId}/accounts/new`}
          className="fixed right-4 bottom-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gold-500 text-brand-950 shadow-lg sm:hidden"
          aria-label="Add account"
        >
          <LuPlus className="h-6 w-6" />
        </a>
      )}
      <StorageFooter />
    </div>
  );
}
