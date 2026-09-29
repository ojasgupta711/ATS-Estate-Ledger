import { createContext, useContext, useState, type ReactNode } from 'react';
import { load, remove, save } from '../lib/storage';

// PROTOTYPE AUTH — runs entirely in the browser so the flow can be clicked through.
// In the next phase this is replaced by real server-side auth (e.g. Auth.js on Vercel)
// with hashed passwords in a database, emailed verification codes and real Google OAuth.

export interface User {
  email: string;
  name: string;
  provider: 'password' | 'google';
  passwordHash?: string;
  verified: boolean;
}

export interface Session {
  email: string;
  name: string;
  provider: User['provider'];
}

interface PendingVerification {
  email: string;
  code: string;
}

interface AuthCtx {
  session: Session | null;
  pending: PendingVerification | null;
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string; needsVerification?: boolean }>;
  signUp: (name: string, email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  verify: (code: string) => { ok: true } | { ok: false; error: string };
  resendCode: () => void;
  signInWithGoogle: (name: string, email: string) => void;
  signOut: () => void;
}

const USERS = 'ats.users';
const SESSION = 'ats.session';
const PENDING = 'ats.pending';

export const DEMO_EMAIL = 'demo@atsestate.com';
export const DEMO_PASSWORD = 'Demo1234!';

async function hash(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ats-demo-salt:${text}`));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // crypto.subtle needs a secure context; fall back to a simple (demo-only) hash.
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return `weak-${h}`;
  }
}

function loadUsers(): User[] {
  return load<User[]>(USERS, []);
}

function newCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 8) p.push('At least 8 characters');
  if (!/[A-Z]/.test(pw)) p.push('One uppercase letter');
  if (!/[a-z]/.test(pw)) p.push('One lowercase letter');
  if (!/\d/.test(pw)) p.push('One number');
  return p;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => load<Session | null>(SESSION, null));
  const [pending, setPending] = useState<PendingVerification | null>(() => load<PendingVerification | null>(PENDING, null));

  const startSession = (u: User) => {
    const s: Session = { email: u.email, name: u.name, provider: u.provider };
    save(SESSION, s);
    setSession(s);
  };

  const setPendingPersist = (p: PendingVerification | null) => {
    if (p) save(PENDING, p);
    else remove(PENDING);
    setPending(p);
  };

  const value: AuthCtx = {
    session,
    pending,
    async signIn(email, password) {
      const e = email.trim().toLowerCase();
      if (e === DEMO_EMAIL && password === DEMO_PASSWORD) {
        startSession({ email: DEMO_EMAIL, name: 'Demo Advisor', provider: 'password', verified: true });
        return { ok: true };
      }
      const u = loadUsers().find((x) => x.email === e);
      if (!u || u.provider !== 'password' || u.passwordHash !== (await hash(password))) {
        return { ok: false, error: 'Email or password is incorrect.' };
      }
      if (!u.verified) {
        setPendingPersist({ email: e, code: newCode() });
        return { ok: false, error: 'Please verify your email first.', needsVerification: true };
      }
      startSession(u);
      return { ok: true };
    },
    async signUp(name, email, password) {
      const e = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: 'Enter a valid email address.' };
      if (passwordProblems(password).length) return { ok: false, error: 'Password does not meet the requirements.' };
      const users = loadUsers();
      if (e === DEMO_EMAIL || users.some((u) => u.email === e)) return { ok: false, error: 'An account with this email already exists. Sign in instead.' };
      users.push({ email: e, name: name.trim(), provider: 'password', passwordHash: await hash(password), verified: false });
      save(USERS, users);
      setPendingPersist({ email: e, code: newCode() });
      return { ok: true };
    },
    verify(code) {
      if (!pending) return { ok: false, error: 'No verification in progress.' };
      if (code.trim() !== pending.code) return { ok: false, error: 'That code is not correct. Check it and try again.' };
      const users = loadUsers();
      const u = users.find((x) => x.email === pending.email);
      if (!u) return { ok: false, error: 'Account not found.' };
      u.verified = true;
      save(USERS, users);
      setPendingPersist(null);
      startSession(u);
      return { ok: true };
    },
    resendCode() {
      if (pending) setPendingPersist({ ...pending, code: newCode() });
    },
    signInWithGoogle(name, email) {
      const e = email.trim().toLowerCase();
      const users = loadUsers();
      let u = users.find((x) => x.email === e);
      if (!u) {
        u = { email: e, name, provider: 'google', verified: true };
        users.push(u);
        save(USERS, users);
      }
      startSession({ ...u, provider: 'google' });
    },
    signOut() {
      remove(SESSION);
      setSession(null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
