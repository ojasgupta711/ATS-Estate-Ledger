import { useState, type FormEvent, type ReactNode } from 'react';
import { LuCheck, LuEye, LuEyeOff, LuFileUp, LuFolderTree, LuLock, LuMail, LuShieldCheck, LuFileText } from 'react-icons/lu';
import { Logo, ThemeToggle } from '../../components/AppShell';
import { ATS_LOGO_DATA_URL } from '../../data/logo';
import { Button, Callout, Field, Modal } from '../../components/ui';
import { cx } from '../../lib/format';
import { navigate } from '../../lib/router';
import { DEMO_EMAIL, DEMO_PASSWORD, passwordProblems, useAuth } from '../../state/auth';

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AuthLayout({ children }: { children: ReactNode }) {
  const points = [
    { icon: <LuFileUp className="h-5 w-5" />, text: 'Import Schwab, Nationwide and other custodian spreadsheets — no retyping.' },
    { icon: <LuFolderTree className="h-5 w-5" />, text: 'Organize qualified accounts, CRTs, family and children’s trusts in one hierarchy.' },
    { icon: <LuShieldCheck className="h-5 w-5" />, text: 'Duplicate checks, source tracking and confirmations before any value changes.' },
    { icon: <LuFileText className="h-5 w-5" />, text: 'Generate a client-ready estate summary PDF with automatic totals.' },
  ];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand-700/40 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-gold-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white p-1.5 ring-1 ring-white/15">
            <img src={ATS_LOGO_DATA_URL} alt="ATS" className="h-full w-full object-contain" />
          </span>
          <div>
            <p className="font-display text-xl font-semibold">ATS Estate Ledger</p>
            <p className="text-[11px] tracking-[0.18em] text-gold-300 uppercase">Advanced Trustee Strategies</p>
          </div>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="font-display text-4xl leading-tight font-semibold">Every account, trust and value — organized, verified and totaled.</h1>
          <ul className="mt-8 space-y-4">
            {points.map((p, i) => (
              <li key={i} className="flex gap-3 text-sm text-brand-100">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-gold-300">{p.icon}</span>
                <span className="pt-2">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-brand-300">Prototype · for internal review</p>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <div className="lg:invisible">
            <Logo />
          </div>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-8">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <LuLock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input id={id} className="input pr-10 pl-9" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <LuEyeOff className="h-4 w-4" /> : <LuEye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function GoogleButton() {
  const { signInWithGoogle } = useAuth();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const pick = (name: string, email: string) => {
    signInWithGoogle(name, email);
    setOpen(false);
    navigate('/clients');
  };
  return (
    <>
      <Button variant="secondary" size="lg" className="w-full" icon={<GoogleG />} onClick={() => setOpen(true)}>
        Continue with Google
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Sign in with Google" size="sm">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Prototype: this simulates Google’s account chooser. Real Google OAuth is connected in the server phase.</p>
        <button onClick={() => pick('Jordan Advisor', 'jordan.advisor@example.com')} className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">J</span>
          <span>
            <span className="block text-sm font-medium">Jordan Advisor</span>
            <span className="block text-xs text-slate-500">jordan.advisor@example.com</span>
          </span>
        </button>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(custom)) pick(custom.split('@')[0], custom);
          }}
        >
          <input className="input" type="email" placeholder="Use another account" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button type="submit" variant="secondary">
            Next
          </Button>
        </form>
      </Modal>
    </>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      or
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await signIn(email, password);
    setBusy(false);
    if (r.ok) navigate('/clients');
    else if (r.needsVerification) navigate('/verify');
    else setError(r.error);
  };

  return (
    <AuthLayout>
      <h2 className="font-display text-3xl font-semibold text-brand-900 dark:text-white">Welcome back</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign in to manage your clients’ estates.</p>
      <div className="mt-8">
        <GoogleButton />
      </div>
      <Divider />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <div className="relative">
            <LuMail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="email" className="input pl-9" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <button
        type="button"
        onClick={() => {
          setEmail(DEMO_EMAIL);
          setPassword(DEMO_PASSWORD);
        }}
        className="mt-4 w-full cursor-pointer rounded-lg border border-dashed border-gold-300 bg-gold-100/50 px-3 py-2 text-xs text-gold-700 hover:bg-gold-100 dark:border-gold-700 dark:bg-gold-700/10 dark:text-gold-300"
      >
        Use demo login · {DEMO_EMAIL} / {DEMO_PASSWORD}
      </button>
      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
        New to ATS Estate Ledger?{' '}
        <a href="#/signup" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
          Create an account
        </a>
      </p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const problems = passwordProblems(password);
  const rules = ['At least 8 characters', 'One uppercase letter', 'One lowercase letter', 'One number'];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Enter your name.');
    if (password !== confirm) return setError('Passwords do not match.');
    const r = await signUp(name, email, password);
    if (r.ok) navigate('/verify');
    else setError(r.error);
  };

  return (
    <AuthLayout>
      <h2 className="font-display text-3xl font-semibold text-brand-900 dark:text-white">Create your account</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">We’ll send a code to verify your email.</p>
      <div className="mt-8">
        <GoogleButton />
      </div>
      <Divider />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" htmlFor="name">
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </Field>
        <Field label="Email" htmlFor="email">
          <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {rules.map((r) => {
              const ok = password.length > 0 && !problems.includes(r);
              return (
                <li key={r} className={cx('flex items-center gap-1 text-[11px]', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')}>
                  <LuCheck className="h-3 w-3" /> {r}
                </li>
              );
            })}
          </ul>
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={confirm && confirm !== password ? 'Passwords do not match' : undefined}>
          <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
        <Button type="submit" size="lg" className="w-full" disabled={problems.length > 0 || !confirm}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
        Already have an account?{' '}
        <a href="#/login" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
          Sign in
        </a>
      </p>
    </AuthLayout>
  );
}

export function VerifyPage() {
  const { pending, verify, resendCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  if (!pending) {
    return (
      <AuthLayout>
        <Callout tone="info" title="Nothing to verify">
          Start by creating an account.
        </Callout>
        <Button className="mt-4 w-full" href="/signup">
          Create an account
        </Button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
        <LuMail className="h-6 w-6" />
      </span>
      <h2 className="mt-4 font-display text-3xl font-semibold text-brand-900 dark:text-white">Check your email</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Enter the 6-digit code sent to <span className="font-medium text-slate-800 dark:text-slate-200">{pending.email}</span>.
      </p>
      <Callout tone="warning" className="mt-5" title="Prototype">
        Email sending is not connected yet. Your code is <span className="font-mono font-semibold tracking-widest" data-testid="demo-code">{pending.code}</span>
      </Callout>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const r = verify(code);
          if (r.ok) navigate('/clients');
          else setError(r.error);
        }}
      >
        <Field label="Verification code" htmlFor="code">
          <input id="code" className="input text-center font-mono text-lg tracking-[0.5em]" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" />
        </Field>
        {error && <Callout tone="error">{error}</Callout>}
        <Button type="submit" size="lg" className="w-full" disabled={code.length !== 6}>
          Verify and continue
        </Button>
      </form>
      <button onClick={resendCode} className="mt-4 w-full cursor-pointer text-center text-sm text-brand-700 hover:underline dark:text-brand-300">
        Send a new code
      </button>
    </AuthLayout>
  );
}
