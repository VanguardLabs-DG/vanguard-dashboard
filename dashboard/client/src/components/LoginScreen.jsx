/**
 * LoginScreen.jsx — Vanguard Dashboard authentication screen.
 *
 * Sends credentials to the backend REST endpoint, receives
 * a token and user profile, and passes it up to App via onLogin callback.
 *
 * @module LoginScreen
 */

import { useState } from 'react';
import { motion as Motion } from 'framer-motion';
import { ShieldCheck, Lock, User, ArrowRight } from '@phosphor-icons/react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:3001');

/**
 * @param {{ onLogin: (token: string, user: object) => void }} props
 */
export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /** Handle form submission */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();

      if (data.success && data.token) {
        onLogin(data.token, data.user);
      } else {
        setError(data.error || 'Credenciais inválidas.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <Motion.div
        className="login-card"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '8px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: 'var(--color-accent, #10b981)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={22} weight="bold" />
          </div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '0.5px' }}>
            Vanguard <span style={{ color: 'var(--color-accent, #10b981)', fontWeight: 600 }}>Dashboard</span>
          </h1>
        </div>
        <p style={{ margin: '0 0 24px 0', fontSize: '0.85rem', color: 'var(--color-text-secondary, #94a3b8)' }}>
          Console de Vigilância & Moderação Tática
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={14} /> Usuário
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex: isa, mimy, dege..."
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lock size={14} /> Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite sua senha"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '12px',
            }}
          >
            <span>{loading ? 'Autenticando...' : 'Acessar Painel'}</span>
            {!loading && <ArrowRight size={16} weight="bold" />}
          </button>
        </form>

        {error && (
          <Motion.div
            className="login-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </Motion.div>
        )}
      </Motion.div>
    </div>
  );
}
