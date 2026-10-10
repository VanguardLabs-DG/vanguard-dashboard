/**
 * StaffManagementModal.jsx — Painel de Gestão de Equipe (SuperAdmin Exclusivo)
 *
 * Permite ao gestor (Dege) visualizar todos os administradores cadastrados,
 * status do primeiro login e resetar senhas esquecidas com segurança.
 *
 * @module StaffManagementModal
 */

import { useState, useEffect, useCallback } from 'react';
import { motion as Motion } from 'framer-motion';
import {
  X,
  UsersThree,
  Key,
  ShieldCheck,
  CheckCircle,
  Clock,
  ArrowsClockwise,
  WarningCircle,
} from '@phosphor-icons/react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || (typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://localhost:3001');

export default function StaffManagementModal({ token, onClose }) {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/staff`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.staff)) {
        setStaffList(data.staff);
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Erro ao carregar equipe.' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Não foi possível conectar ao servidor.' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleResetPassword = async (username) => {
    if (!window.confirm(`Tem certeza que deseja resetar a senha de ${username} para a senha temporária 'vanguard@2026'?`)) {
      return;
    }

    setActionLoading(username);
    setStatusMessage(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/auth/staff/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username }),
      });

      const data = await res.json();
      if (data.success) {
        setStatusMessage({ type: 'success', text: data.message });
        await fetchStaff();
      } else {
        setStatusMessage({ type: 'error', text: data.error || 'Falha ao resetar senha.' });
      }
    } catch {
      setStatusMessage({ type: 'error', text: 'Erro ao enviar comando de redefinição.' });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="dossier-backdrop" onClick={onClose}>
      <Motion.div
        className="dossier-modal"
        style={{ maxWidth: '780px', padding: 0 }}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      >
        {/* Header */}
        <div className="dossier-header">
          <div className="dossier-header-left">
            <div className="dossier-avatar" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
              <UsersThree size={24} weight="bold" />
            </div>
            <div className="dossier-titles">
              <div className="dossier-char-name">Gestão da Equipe de Staff</div>
              <div className="dossier-sub-name">
                Controle de acessos, administradores e redefinição de senhas
              </div>
            </div>
          </div>

          <div className="dossier-header-actions">
            <button
              className="btn-refresh-inv"
              onClick={fetchStaff}
              disabled={loading}
              title="Atualizar lista"
            >
              <ArrowsClockwise size={16} className={loading ? 'spin-animation' : ''} />
              <span>Atualizar</span>
            </button>
            <button className="btn-icon" onClick={onClose} title="Fechar">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Status Alert */}
        {statusMessage && (
          <div
            style={{
              margin: '16px 24px 0 24px',
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${statusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              color: statusMessage.type === 'success' ? '#10b981' : '#ef4444',
            }}
          >
            {statusMessage.type === 'success' ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Content */}
        <div style={{ padding: '20px 24px' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            {staffList.map((member) => {
              const isSuper = member.role === 'superadmin';
              const isPending = member.mustChangePassword;

              return (
                <div
                  key={member.username}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'var(--color-surface, #0e1524)',
                    border: '1px solid var(--color-border, rgba(148, 163, 184, 0.15))',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: isSuper ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.12)',
                        color: isSuper ? '#10b981' : '#38bdf8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                      }}
                    >
                      {member.displayName ? member.displayName[0].toUpperCase() : member.username[0].toUpperCase()}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--color-text, #f8fafc)' }}>
                          {member.displayName}
                        </span>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: isSuper ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.12)',
                            color: isSuper ? '#10b981' : '#38bdf8',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {isSuper ? 'SUPERADMIN' : 'ADM'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary, #94a3b8)', marginTop: '2px' }}>
                        Login: <span className="font-mono">@{member.username}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    {/* Status da Senha */}
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: isPending ? '#eab308' : '#10b981',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          justifyContent: 'flex-end',
                        }}
                      >
                        {isPending ? (
                          <>
                            <WarningCircle size={14} weight="fill" />
                            <span>Senha Temporária</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={14} weight="bold" />
                            <span>Senha Definida</span>
                          </>
                        )}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-faint, #64748b)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <Clock size={12} />
                        <span>
                          {member.lastLogin
                            ? `Último acesso: ${new Date(member.lastLogin).toLocaleDateString('pt-BR')} ${new Date(member.lastLogin).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                            : 'Nunca acessou'}
                        </span>
                      </div>
                    </div>

                    {/* Botão de Resetar Senha */}
                    <button
                      className="btn-secondary"
                      onClick={() => handleResetPassword(member.username)}
                      disabled={actionLoading === member.username}
                      title="Resetar senha para vanguard@2026"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                      }}
                    >
                      <Key size={14} />
                      <span>{actionLoading === member.username ? 'Resetando...' : 'Resetar Senha'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Motion.div>
    </div>
  );
}
