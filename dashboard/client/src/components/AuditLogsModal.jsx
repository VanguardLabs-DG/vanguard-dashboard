/**
 * AuditLogsModal.jsx — Painel de Auditoria e Histórico de Ações da Staff
 *
 * Pilar 1: Telagem & Moderação Avançada
 * - Histórico de quem telou quem, horário, duração e ações executadas
 * - Auditoria de comandos administrativos (freeze, revive, heal, warn, kick)
 *
 * @module AuditLogsModal
 */

import { useState, useEffect } from 'react';
import { motion as Motion } from 'framer-motion';
import {
  X,
  Scroll,
  Eye,
  ShieldWarning,
  ArrowsClockwise,
  MagnifyingGlass,
  Snowflake,
  FirstAid,
  Bandaids,
  PaperPlaneTilt,
  Prohibit,
  MapPin,
  Clock,
  User,
} from '@phosphor-icons/react';
import { getSocket } from '../socket';

export default function AuditLogsModal({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all'); // 'all' | 'stream' | 'moderation'
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = () => {
    setLoading(true);
    const socket = getSocket();
    if (!socket) {
      setLoading(false);
      return;
    }

    socket.emit('get_audit_logs', (data) => {
      setLoading(false);
      if (Array.isArray(data)) {
        setLogs(data);
      }
    });
  };

  useEffect(() => {
    fetchLogs();

    const socket = getSocket();
    if (!socket) return;

    const handleNewEntry = (entry) => {
      setLogs((prev) => [entry, ...prev.filter((l) => l.id !== entry.id)]);
    };

    socket.on('audit_log_entry', handleNewEntry);

    return () => {
      socket.off('audit_log_entry', handleNewEntry);
    };
  }, []);

  const getActionBadge = (action) => {
    switch (action) {
      case 'start_stream':
        return (
          <span className="audit-action-badge stream">
            <Eye size={12} weight="fill" /> Início de Telagem
          </span>
        );
      case 'stop_stream':
        return (
          <span className="audit-action-badge stop">
            <Eye size={12} /> Fim de Telagem
          </span>
        );
      case 'freeze':
        return (
          <span className="audit-action-badge freeze">
            <Snowflake size={12} weight="bold" /> Congelamento
          </span>
        );
      case 'revive':
        return (
          <span className="audit-action-badge revive">
            <FirstAid size={12} weight="bold" /> Reviver (God)
          </span>
        );
      case 'heal':
        return (
          <span className="audit-action-badge heal">
            <Bandaids size={12} weight="bold" /> Curar (Heal)
          </span>
        );
      case 'warn':
        return (
          <span className="audit-action-badge warn">
            <PaperPlaneTilt size={12} weight="bold" /> Aviso na Tela
          </span>
        );
      case 'kick':
        return (
          <span className="audit-action-badge kick">
            <Prohibit size={12} weight="bold" /> Expulsão (Kick)
          </span>
        );
      case 'teleport':
        return (
          <span className="audit-action-badge teleport">
            <MapPin size={12} weight="bold" /> Teletransporte
          </span>
        );
      default:
        return <span className="audit-action-badge default">{action}</span>;
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (filterCategory !== 'all' && log.category !== filterCategory) {
      return false;
    }
    const q = searchQuery.toLowerCase();
    const str = `${log.action} ${log.adminName} ${log.targetPlayerId} ${log.targetPlayerName || ''} ${JSON.stringify(log.details || '')}`.toLowerCase();
    return str.includes(q);
  });

  return (
    <div className="dossier-backdrop" onClick={onClose}>
      <Motion.div
        className="dossier-modal audit-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      >
        {/* Header */}
        <div className="dossier-header">
          <div className="dossier-header-left">
            <div className="dossier-avatar audit-avatar">
              <Scroll size={22} weight="bold" />
            </div>
            <div className="dossier-titles">
              <div className="dossier-char-name">Auditoria & Logs de Staff</div>
              <div className="dossier-sub-name">
                Registro imutável de vigilância e ações disciplinares
              </div>
            </div>
          </div>

          <div className="dossier-header-actions">
            <button
              className="btn-refresh-inv"
              onClick={fetchLogs}
              disabled={loading}
              title="Atualizar registros"
            >
              <ArrowsClockwise
                size={16}
                className={loading ? 'spin-animation' : ''}
              />
              <span>Atualizar</span>
            </button>
            <button className="btn-icon" onClick={onClose} title="Fechar">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Toolbar de Filtro */}
        <div className="audit-toolbar">
          <div className="audit-category-filters">
            <button
              className={`audit-cat-btn ${filterCategory === 'all' ? 'active' : ''}`}
              onClick={() => setFilterCategory('all')}
            >
              Todos ({logs.length})
            </button>
            <button
              className={`audit-cat-btn ${filterCategory === 'stream' ? 'active' : ''}`}
              onClick={() => setFilterCategory('stream')}
            >
              <Eye size={14} />
              <span>Telagens</span>
            </button>
            <button
              className={`audit-cat-btn ${filterCategory === 'moderation' ? 'active' : ''}`}
              onClick={() => setFilterCategory('moderation')}
            >
              <ShieldWarning size={14} />
              <span>Moderação</span>
            </button>
          </div>

          <div className="inv-search-box audit-search">
            <MagnifyingGlass size={16} />
            <input
              type="text"
              placeholder="Buscar por staff, jogador ou motivo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Lista de Registros */}
        <div className="audit-list-container">
          {loading && logs.length === 0 ? (
            <div className="inv-loading-state">
              <ArrowsClockwise size={32} className="spin-animation" />
              <span>Carregando logs de auditoria...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="inv-empty-state">
              <Scroll size={40} className="text-muted" />
              <span>Nenhum registro de auditoria encontrado.</span>
            </div>
          ) : (
            <div className="audit-table">
              {filteredLogs.map((log) => {
                const date = new Date(log.timestamp);
                const timeStr = date.toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });
                const dateStr = date.toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                });

                return (
                  <div key={log.id} className="audit-row">
                    <div className="audit-cell-time font-mono">
                      <Clock size={14} className="text-muted" />
                      <span>{timeStr}</span>
                      <span className="text-muted date-tag">{dateStr}</span>
                    </div>

                    <div className="audit-cell-admin">
                      <User size={14} className="text-secondary" />
                      <span className="admin-name">{log.adminName}</span>
                    </div>

                    <div className="audit-cell-action">
                      {getActionBadge(log.action)}
                    </div>

                    <div className="audit-cell-target">
                      <span className="target-id font-mono">#{log.targetPlayerId}</span>
                      <span className="target-name">
                        {log.targetPlayerName || `Player ${log.targetPlayerId}`}
                      </span>
                    </div>

                    <div className="audit-cell-details text-secondary font-mono">
                      {log.details?.options?.reason && (
                        <span>Motivo: "{log.details.options.reason}"</span>
                      )}
                      {log.details?.options?.message && (
                        <span>Aviso: "{log.details.options.message}"</span>
                      )}
                      {log.details?.options?.coords && (
                        <span>
                          Coords: [{log.details.options.coords.x.toFixed(1)},{' '}
                          {log.details.options.coords.y.toFixed(1)},{' '}
                          {log.details.options.coords.z.toFixed(1)}]
                        </span>
                      )}
                      {log.details?.result && (
                        <span className="text-muted">({log.details.result})</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Motion.div>
    </div>
  );
}
