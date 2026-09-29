import { useEffect, type ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { match, navigate, query, useRoute } from './lib/router';
import { AccountDetailPage, AccountsPage, AddAccountPage } from './pages/AccountPages';
import { LoginPage, SignupPage, VerifyPage } from './pages/auth/AuthPages';
import { ClientsPage } from './pages/Clients';
import { DashboardPage } from './pages/Dashboard';
import { BreakdownPage, HierarchyPage, SummaryPage } from './pages/EstatePages';
import { ImportDetailPage, ImportHistoryPage, QualityPage } from './pages/HistoryQualityPages';
import { ImportWizardPage } from './pages/ImportWizard';
import { ReportPage } from './pages/ReportPage';
import { SettingsPage } from './pages/Settings';
import { NewTrustPage, TrustDetailPage, TrustsListPage } from './pages/TrustPages';
import { AuthProvider, useAuth } from './state/auth';
import { StoreProvider, useStore, type Backend } from './state/store';
import { ThemeProvider } from './state/theme';

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

function Routes() {
  const path = useRoute();
  const { session } = useAuth();
  const { data } = useStore();

  // Public routes
  if (path.startsWith('/login')) return session ? <Redirect to="/clients" /> : <LoginPage />;
  if (path.startsWith('/signup')) return session ? <Redirect to="/clients" /> : <SignupPage />;
  if (path.startsWith('/verify')) return <VerifyPage />;
  if (!session) return <Redirect to="/login" />;

  if (path === '/' || path === '') return <Redirect to="/clients" />;
  if (path.startsWith('/clients'))
    return (
      <AppShell>
        <ClientsPage path={path} />
      </AppShell>
    );
  if (path.startsWith('/settings'))
    return (
      <AppShell>
        <SettingsPage />
      </AppShell>
    );

  const cm = match('/c/:cid', path) ?? (path.startsWith('/c/') ? { cid: path.split('/')[2]?.split('?')[0] } : null);
  if (cm?.cid) {
    const cid = cm.cid;
    if (!data.clients.some((c) => c.id === cid)) return <Redirect to="/clients" />;
    const rest = path.split('?')[0].split('/').slice(3); // after /c/:cid
    const section = rest[0] ?? '';
    let page: ReactNode = null;
    let m: Record<string, string> | null;

    if (rest.length === 0) page = <DashboardPage clientId={cid} />;
    else if (section === 'summary') page = <SummaryPage clientId={cid} />;
    else if ((m = match('/c/:cid/breakdown/:type', path))) page = <BreakdownPage clientId={cid} type={m.type} />;
    else if (section === 'breakdown') page = <BreakdownPage clientId={cid} />;
    else if (section === 'hierarchy') page = <HierarchyPage clientId={cid} />;
    else if (match('/c/:cid/accounts/new', path)) page = <AddAccountPage clientId={cid} path={path} />;
    else if ((m = match('/c/:cid/accounts/:aid', path))) page = <AccountDetailPage key={m.aid} clientId={cid} accountId={m.aid} path={path} />;
    else if (section === 'accounts') page = <AccountsPage clientId={cid} path={path} />;
    else if (section === 'import') page = <ImportWizardPage clientId={cid} />;
    else if ((m = match('/c/:cid/imports/:iid', path))) page = <ImportDetailPage clientId={cid} importId={m.iid} />;
    else if (section === 'imports') page = <ImportHistoryPage clientId={cid} />;
    else if (section === 'quality') page = <QualityPage clientId={cid} />;
    else if (match('/c/:cid/trusts/new', path)) page = <NewTrustPage clientId={cid} parentId={query(path).get('parent')} />;
    else if ((m = match('/c/:cid/trusts/:nid', path))) page = <TrustDetailPage key={m.nid} clientId={cid} nodeId={m.nid} />;
    else if (section === 'trusts') page = <TrustsListPage clientId={cid} />;
    else if (section === 'report') page = <ReportPage clientId={cid} />;
    else page = <Redirect to={`/c/${cid}`} />;

    const navSection = section === 'accounts' && rest[1] ? 'accounts' : section;
    try {
      localStorage.setItem('ats.lastClient', cid);
    } catch {
      /* ignore */
    }
    return (
      <AppShell clientId={cid} section={navSection}>
        {page}
      </AppShell>
    );
  }
  return <Redirect to="/clients" />;
}

export default function App({ backend, serverData }: { backend: Backend; serverData?: unknown }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <StoreProvider backend={backend} serverData={serverData}>
          <ToastProvider>
            <ConfirmProvider>
              <Routes />
            </ConfirmProvider>
          </ToastProvider>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
