/**
 * ChangePasswordModal.jsx — Modal de Troca de Senha Obrigatória / Voluntária
 *
 * Exibido no primeiro login quando a senha temporária (vanguard@2026) está ativa,
 * forçando a administradora a criar sua senha pessoal privada.
 *
 * @module ChangePasswordModal
 */

import { useState } from 'react';
import { motion as Motion } from 'framer-motion';
import { LockKey, Key, Check, WarningCircle } from '@phosphor-icons/react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:3001');

export default function ChangePasswordModal({ token, user, isMandatory = true, onClose, onSuccess }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (newPassword === 'vanguard@2026') {
      setError('Escolha uma senha pessoal diferente da senha temporária inicial.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas digitadas não coincidem.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const data = await res.json();

      if (data.success && data.token) {
        onSuccess(data.token, data.user);
      } else {
        setError(data.error || 'Erro ao atualizar a senha.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor para alterar a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dossier-backdrop" onClick={isMandatory ? undefined : onClose}>
      <Motion.div
        className="dossier-modal"
        style={{ maxWidth: '440px', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      >
        <div className="dossier-header">
          <div className="dossier-header-left">
            <div className="dossier-avatar" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
              <LockKey size={22} weight="bold" />
            </div>
            <div className="dossier-titles">
              <div className="dossier-char-name">
                {isMandatory ? 'Definição de Senha Pessoal' : 'Alterar Senha'}
              </div>
              <div className="dossier-sub-name">
                Operador: <strong>{user?.displayName || user?.username}</strong>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {isMandatory && (
            <div
              style={{
                display: 'flex',
                gap: '10px',
                padding: '12px 14px',
                background: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.25)',
                borderRadius: '8px',
                color: '#eab308',
                fontSize: '0.82rem',
                lineHeight: 1.4,
                marginBottom: '18px',
              }}
            >
              <WarningCircle size={20} weight="fill" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Primeiro Acesso Detectado:</strong> Por motivos de segurança, você deve definir sua senha pessoal privada antes de usar o painel.
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="newPassword" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Key size={14} /> Nova Senha (mínimo 6 dígitos)
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Digite sua nova senha"
                autoComplete="new-password"
                required
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="confirmPassword" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Check size={14} /> Confirmar Nova Senha
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
                autoComplete="new-password"
                required
              />
            </div>

            {error && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              {!isMandatory && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                  disabled={loading}
                  style={{ flex: 1 }}
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{ flex: 1 }}
              >
                {loading ? 'Salvando...' : 'Salvar Senha'}
              </button>
            </div>
          </form>
        </div>
      </Motion.div>
    </div>
  );
}
