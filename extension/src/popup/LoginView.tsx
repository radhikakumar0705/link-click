import React, { useState } from 'react';
import { api } from '../api/client';
import { storage } from '../utils/storage';
import Logo from './Logo';

type Mode = 'login' | 'register';

export default function LoginView({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }): React.ReactElement {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res =
      mode === 'login'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password, displayName.trim() || undefined);
    setLoading(false);

    if (!res.data) {
      const fieldErrors = res.details as Record<string, string[] | undefined> | undefined;
      const firstField = fieldErrors && Object.values(fieldErrors).find((v) => Array.isArray(v) && v.length)?.[0];
      setError(firstField ?? res.error ?? 'Something went wrong.');
      return;
    }

    const { accessToken, refreshToken, user } = res.data;
    await storage.setAuth({
      accessToken,
      refreshToken,
      userId: user.id,
      email: user.email,
      tier: user.tier,
      displayName: user.displayName ?? null,
    });
    onDone();
  }

  return (
    <div className="h-full px-6 py-6 flex flex-col gap-5">
      <button onClick={onCancel} className="self-start text-xs text-gray-500 hover:text-gray-800">
        ← Back
      </button>

      <div className="text-center flex flex-col items-center gap-2">
        <Logo className="w-10 h-10" />
        <div className="text-xl font-bold text-gray-900">{mode === 'login' ? 'Sign in to link-click' : 'Create your account'}</div>
        <div className="text-xs text-gray-500">History, custom aliases, expiry dates and analytics.</div>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        {mode === 'register' && (
          <input type="text" placeholder="Display name (optional)" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input" autoComplete="nickname" />
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input" autoComplete="email" autoFocus />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === 'register' ? 8 : 1}
          className="input"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {mode === 'register' && <p className="text-[11px] text-gray-400 -mt-1">At least 8 characters, one uppercase letter and one digit.</p>}

        {error && <div className="alert-error">{error}</div>}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="text-center text-xs text-gray-500">
        {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
        <button
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
          className="text-brand-600 font-semibold hover:underline"
        >
          {mode === 'login' ? 'Sign up free' : 'Sign in'}
        </button>
      </p>
    </div>
  );
}
