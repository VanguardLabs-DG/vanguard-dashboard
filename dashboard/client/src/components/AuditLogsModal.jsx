/**
 * AuditLogsModal.jsx — Painel de Auditoria e Histórico de Ações da Staff
 *
 * Pilar 1: Telagem & Moderação Avançada
 * - Histórico de quem telou quem, horário, duração e ações executadas
 * - Auditoria de comandos administrativos (freeze, revive, heal, warn, kick)
 *
 * Totalmente blindado contra dados nulos, malformados ou incompatibilidades de navegador.
 *
 * @module AuditLogsModal
 */

import { useState, useEffect, useCallback } from 'react';
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

/**
 * Converte com segurança qualquer valor para exibição em texto sem quebrar o JSX.
 */
function safeText(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'Sim' : 'Não';
  try {
    return JSON.stringify(val);
  } catch (_e) {
    return String(val);
  }
}

/**
 * Formata coordenadas com segurança, suportando {x,y,z}, {X,Y,Z} ou [x,y,z].
 */
function formatCoords(coords) {
  if (!coords) return null;
  let x, y, z;
  if (Array.isArray(coords)) {
    [x, y, z] = coords;
  } else if (typeof coords === 'object') {
    x = coords.x !== undefined ? coords.x : coords.X;
    y = coords.y !== undefined ? coords.y : coords.Y;
    z = coords.z !== undefined ? coords.z : coords.Z;
  }
  const nx = Number(x);
  const ny = Number(y);
  const nz = Number(z);
  if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
    return `[${nx.toFixed(1)}, ${ny.toFixed(1)}, ${nz.toFixed(1)}]`;
  }
  return null;
}

/**
 * Converte timestamp em string legível sem disparar RangeError em navegadores estritos.
 */
function safeDate(timestamp) {
  if (!timestamp) {
    return { timeStr: '--:--:--', dateStr: '--/--' };
  }
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {
      return { timeStr: '--:--:--', dateStr: '--/--' };
    }
    const timeStr = d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const dateStr = d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    return { timeStr, dateStr };
  } catch (_e) {
    return { timeStr: '--:--:--', dateStr: '--/--' };
  }
}

export default function AuditLogsModal({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all'); // 'all' | 'stream' | 'moderation'
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = useCallback(() => {
    setLoading(true);
    const socket = getSocket();
    if (!socket) {
      setLoading(false);
      return;
    }

    try {
      socket.emit('get_audit_logs', (data) => {
        setLoading(false);
        if (Array.isArray(data)) {
          // Filtra elementos inválidos
          setLogs(data.filter((item) => item && typeof item === 'object'));
        }
      });
    } catch (err) {
      console.error('[AuditLogsModal] Erro ao buscar logs:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();

    const socket = getSocket();
    if (!socket) return;

    const handleNewEntry = (entry) => {
      if (!entry || typeof entry !== 'object') return;
      setLogs((prev) => {
        const entryId = entry.id || `log_${Date.now()}`;
        return [entry, ...prev.filter((l) => l && l.id !== entryId)];
      });
    };

    socket.on('audit_log_entry', handleNewEntry);

    return () => {
      socket.off('audit_log_entry', handleNewEntry);
    };
  }, [fetchLogs]);

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
        return <span className="audit-action-badge default">{safeText(action)}</span>;
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (!log || typeof log !== 'object') return false;
    if (filterCategory !== 'all' && log.category !== filterCategory) {
      return false;
    }
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return true;

    try {
      const action = String(log.action || '');
      const admin = String(log.adminName || '');
      const pid = String(log.targetPlayerId || '');
      const pname = String(log.targetPlayerName || '');
      const details = log.details ? JSON.stringify(log.details) : '';
      const str = `${action} ${admin} ${pid} ${pname} ${details}`.toLowerCase();
      return str.includes(q);
    } catch (_e) {
      return true;
    }
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
              {filteredLogs.map((log, index) => {
                const { timeStr, dateStr } = safeDate(log.timestamp);
                const coordsFormatted = formatCoords(log.details?.options?.coords);
                const logKey = log.id || `audit_idx_${index}_${log.timestamp || ''}`;

                return (
                  <div key={logKey} className="audit-row">
                    <div className="audit-cell-time font-mono">
                      <Clock size={14} className="text-muted" />
                      <span>{timeStr}</span>
                      <span className="text-muted date-tag">{dateStr}</span>
                    </div>

                    <div className="audit-cell-admin">
                      <User size={14} className="text-secondary" />
                      <span className="admin-name">{safeText(log.adminName) || 'Admin'}</span>
                    </div>

                    <div className="audit-cell-action">
                      {getActionBadge(log.action)}
                    </div>

                    <div className="audit-cell-target">
                      <span className="target-id font-mono">
                        #{safeText(log.targetPlayerId) || '?'}
                      </span>
                      <span className="target-name">
                        {safeText(log.targetPlayerName) || `Player ${safeText(log.targetPlayerId)}`}
                      </span>
                    </div>

                    <div className="audit-cell-details text-secondary font-mono">
                      {log.details?.options?.reason && (
                        <span>Motivo: "{safeText(log.details.options.reason)}"</span>
                      )}
                      {log.details?.options?.message && (
                        <span>Aviso: "{safeText(log.details.options.message)}"</span>
                      )}
                      {coordsFormatted && (
                        <span>Coords: {coordsFormatted}</span>
                      )}
                      {log.details?.result && (
                        <span className="text-muted">({safeText(log.details.result)})</span>
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
