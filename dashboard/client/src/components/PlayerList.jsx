/**
 * PlayerList.jsx — Sidebar com Telemetria Online e Busca na Base de Dados (Offline)
 *
 * Pilares atendidos:
 * - Pilar 2: Exibição de Nome RP, Emprego/Cargo, Indicador de Veículo (Placa e Velocidade)
 * - Gestão de Jogadores Offline: Consulta direta na tabela MySQL `players` via RPC
 * - Abertura do Dossiê Completo e Inventário (ox_inventory) tanto online quanto offline
 * - Botão de início/término de stream e foco no mapa
 *
 * @module PlayerList
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  Eye,
  Crosshair,
  Users,
  Car,
  Snowflake,
  User,
  Heart,
  Shield,
  Database,
  MagnifyingGlass,
  ArrowsClockwise,
  Coins,
  Clock,
} from '@phosphor-icons/react';
import { getSocket } from '../socket';

/**
 * Formata data de último login com segurança.
 */
function formatLastSeen(val) {
  if (!val) return 'Desconhecido';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_e) {
    return String(val);
  }
}

export default function PlayerList({
  players,
  selectedId,
  streamingIds = [],
  onSelect,
  onStartStream,
  onStopStream,
  onOpenDossier,
}) {
  const [mode, setMode] = useState('online'); // 'online' | 'database'
  const [search, setSearch] = useState('');

  // ─── Estado do Modo Base de Dados (Offline) ────────────────
  const [dbQuery, setDbQuery] = useState('');
  const [dbResults, setDbResults] = useState([]);
  const [dbLoading, setDbLoading] = useState(false);
  const searchTimeoutRef = useRef(null);

  /** Busca na base de dados (automática e com pesquisa) */
  const fetchDatabasePlayers = (searchVal = '') => {
    const socket = getSocket();
    if (!socket) return;
    setDbLoading(true);

    socket.emit('search_database_players', { query: searchVal.trim() }, (response) => {
      setDbLoading(false);
      const list = response?.players || response?.citizens || [];
      if (response && response.success && Array.isArray(list)) {
        setDbResults(list);
      } else {
        setDbResults([]);
      }
    });
  };

  /** Ao alternar para o modo database, busca automaticamente os registros recentes */
  useEffect(() => {
    if (mode === 'database' && dbResults.length === 0 && !dbQuery) {
      fetchDatabasePlayers('');
    }
  }, [mode]);

  /** Busca na base de dados com debounce */
  const handleDbQueryChange = (e) => {
    const val = e.target.value;
    setDbQuery(val);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!val || val.trim().length === 0) {
      fetchDatabasePlayers('');
      return;
    }

    setDbLoading(true);
    searchTimeoutRef.current = setTimeout(() => {
      fetchDatabasePlayers(val);
    }, 300);
  };

  /** Filter online players by search query */
  const filteredOnline = players.filter((p) => {
    const q = search.toLowerCase();
    const cName = p.characterName || '';
    const sName = p.steamName || p.name || '';
    const cid = p.dossier?.citizenid || '';
    const job = p.dossier?.job?.label || '';
    const plate = p.vehicle?.plate || '';

    return (
      cName.toLowerCase().includes(q) ||
      sName.toLowerCase().includes(q) ||
      cid.toLowerCase().includes(q) ||
      job.toLowerCase().includes(q) ||
      plate.toLowerCase().includes(q) ||
      String(p.id).includes(q)
    );
  });

  return (
    <aside className="app-sidebar">
      {/* Abas Superiores: Online vs Base de Dados (Offline) */}
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${mode === 'online' ? 'active' : ''}`}
          onClick={() => setMode('online')}
        >
          <Users size={15} weight={mode === 'online' ? 'bold' : 'regular'} />
          <span>Online ({players.length})</span>
        </button>

        <button
          className={`sidebar-tab ${mode === 'database' ? 'active' : ''}`}
          onClick={() => setMode('database')}
        >
          <Database size={15} weight={mode === 'database' ? 'bold' : 'regular'} />
          <span>Base SQL {dbResults.length > 0 ? `(${dbResults.length})` : ''}</span>
        </button>
      </div>

      {/* ════════════════ MODO 1: JOGADORES ONLINE ════════════════ */}
      {mode === 'online' && (
        <>
          {/* Header */}
          <div className="sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <h2>Conectados ({filteredOnline.length})</h2>
              <span className="sidebar-count-badge font-mono">
                {streamingIds.length > 0 && `${streamingIds.length} telando`}
              </span>
            </div>
          </div>

          {/* Search Online */}
          <div className="sidebar-search">
            <input
              type="text"
              placeholder="Buscar por nome, ID, emprego, placa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Lista Online */}
          <div className="player-list">
            <AnimatePresence mode="popLayout">
              {filteredOnline.length === 0 ? (
                <Motion.div
                  key="empty"
                  className="empty-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <Users size={48} className="empty-state-icon" />
                  <h3>Nenhum jogador encontrado</h3>
                  <p>
                    {players.length === 0
                      ? 'Aguardando sincronização com o FXServer...'
                      : 'Nenhum resultado corresponde à sua pesquisa'}
                  </p>
                </Motion.div>
              ) : (
                filteredOnline.map((player) => {
                  const isStreaming = streamingIds.includes(player.id);
                  const isFrozen = Boolean(player.isFrozen);
                  const dossier = player.dossier;
                  const vehicle = player.vehicle;

                  return (
                    <Motion.div
                      key={player.id}
                      layoutId={`player-${player.id}`}
                      className={`player-card ${selectedId === player.id ? 'active' : ''} ${isFrozen ? 'card-frozen' : ''}`}
                      onClick={() => onSelect(player.id)}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                    >
                      {/* Avatar com ID do servidor */}
                      <div className={`player-avatar ${isFrozen ? 'avatar-frozen' : ''}`}>
                        {player.id}
                      </div>

                      {/* Detalhes do Jogador */}
                      <div className="player-info">
                        <div className="player-name-row">
                          <span className="player-char-name">
                            {player.isInMultichar ? `${player.steamName || `Player ${player.id}`} [Seleção]` : (player.characterName || player.name)}
                          </span>
                          {player.isVoiceMuted && (
                            <span className="frozen-badge" title="Voz Silenciada" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                              🔇
                            </span>
                          )}
                          {player.isChatMuted && (
                            <span className="frozen-badge" title="Chat Bloqueado" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>
                              💬🚫
                            </span>
                          )}
                          {player.isTalking && (
                            <span className="voice-tag talking" title="Falando no VOIP (pma-voice / Mumble)">
                              🎙️
                            </span>
                          )}
                          {isFrozen && (
                            <span className="frozen-badge" title="Jogador Congelado">
                              <Snowflake size={12} weight="bold" />
                            </span>
                          )}
                        </div>

                        <div className="player-sub-meta">
                          <span className="player-job-tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                            Slot #{player.cid || dossier?.cid || 1}
                          </span>
                          {dossier?.job?.label ? (
                            <span className="player-job-tag">
                              {dossier.job.label}
                            </span>
                          ) : (
                            <span className="player-steam-tag font-mono">
                              {player.steamName || `Player ${player.id}`}
                            </span>
                          )}
                          {vehicle?.inVehicle && (
                            <span className="player-veh-tag font-mono" title={`Em veículo: ${vehicle.plate}`}>
                              <Car size={12} /> {vehicle.speedKmH}km/h
                            </span>
                          )}
                        </div>

                        <div className="player-meta font-mono">
                          <span>{player.ping}ms</span>
                          <span className="stat-hp">
                            <Heart size={10} weight="fill" className="text-danger" />{' '}
                            {player.health ?? '—'}
                          </span>
                          <span className="stat-ar">
                            <Shield size={10} weight="fill" style={{ color: '#38bdf8' }} />{' '}
                            {player.armor ?? '—'}
                          </span>
                        </div>
                      </div>

                      {/* Botões de Ação */}
                      <div className="player-actions">
                        {/* Abrir Dossiê & Inventário */}
                        {onOpenDossier && (
                          <button
                            className="btn-icon"
                            title="Ver Dossiê e Inventário"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDossier(player.id);
                            }}
                          >
                            <User size={16} />
                          </button>
                        )}

                        {/* Focar no Mapa */}
                        <button
                          className="btn-icon"
                          title="Localizar no mapa"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelect(player.id);
                          }}
                        >
                          <Crosshair size={16} />
                        </button>

                        {/* Iniciar / Parar Telagem */}
                        <button
                          className={`btn-icon ${isStreaming ? 'live' : ''}`}
                          title={isStreaming ? 'Parar telagem' : 'Telar jogador'}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isStreaming) {
                              onStopStream(player.id);
                            } else {
                              onStartStream(player.id);
                            }
                          }}
                        >
                          <Eye size={16} weight={isStreaming ? 'fill' : 'regular'} />
                        </button>
                      </div>
                    </Motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* ════════════════ MODO 2: BASE DE DADOS (OFFLINE) ════════════════ */}
      {mode === 'database' && (
        <>
          {/* Header */}
          <div className="sidebar-header">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <h2>Registros SQL</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="sidebar-count-badge font-mono">
                  {dbLoading ? 'Consultando...' : `${dbResults.length} cidadãos`}
                </span>
                <button
                  className="btn-icon"
                  style={{ width: '26px', height: '26px' }}
                  title="Atualizar Registros SQL"
                  onClick={() => fetchDatabasePlayers(dbQuery)}
                >
                  <ArrowsClockwise size={13} className={dbLoading ? 'spin-icon' : ''} />
                </button>
              </div>
            </div>
          </div>

          {/* Search Database */}
          <div className="sidebar-search">
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder="Buscar por Nome, CitizenID, Licença..."
                value={dbQuery}
                onChange={handleDbQueryChange}
                style={{ paddingRight: '28px' }}
              />
              {dbLoading && (
                <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}>
                  <ArrowsClockwise size={14} className="spin-icon text-accent" />
                </div>
              )}
            </div>
          </div>

          {/* Lista de Cidadãos da Base de Dados */}
          <div className="player-list">
            <AnimatePresence mode="popLayout">
              {dbResults.length === 0 && !dbLoading ? (
                <Motion.div
                  key="no-results"
                  className="empty-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <MagnifyingGlass size={44} className="empty-state-icon" />
                  <h3>Nenhum cidadão encontrado</h3>
                  <p>
                    {dbQuery
                      ? `Nenhum registro corresponde a "${dbQuery}" na tabela MySQL players.`
                      : 'Nenhum registro cadastrado na base de dados.'}
                  </p>
                </Motion.div>
              ) : (
                dbResults.map((citizen) => {
                  const isOnline = Boolean(citizen.isOnline);
                  const charFullName = `${citizen.charinfo?.firstname || ''} ${citizen.charinfo?.lastname || ''}`.trim();
                  const charName = charFullName || citizen.characterName || (citizen.charinfo?.name || 'Cidadão');
                  const steamName = citizen.name || citizen.steamName || '';
                  const slotNum = Number((citizen.cid !== undefined && citizen.cid !== null) ? citizen.cid : (citizen.charinfo?.cid || 1));
                  const jobLabel = citizen.job?.label || 'Civil';
                  const citizenId = citizen.citizenid;
                  const bankMoney = citizen.money?.bank !== undefined ? citizen.money.bank : 0;
                  const gemsMoney = citizen.money?.gems !== undefined ? citizen.money.gems : 0;

                  return (
                    <Motion.div
                      key={citizenId || citizen.license}
                      layoutId={`citizen-${citizenId}`}
                      className={`player-card ${isOnline ? 'card-online' : 'card-offline'}`}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                      onClick={() => onOpenDossier && onOpenDossier(citizen)}
                    >
                      {/* Avatar */}
                      <div
                        className="player-avatar"
                        style={{
                          background: isOnline ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                          borderColor: isOnline ? 'rgba(16, 185, 129, 0.4)' : 'rgba(148, 163, 184, 0.2)',
                          color: isOnline ? '#10b981' : '#94a3b8',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                        }}
                      >
                        {isOnline ? `#${citizen.onlineId || citizen.id}` : 'OFF'}
                      </div>

                      {/* Info */}
                      <div className="player-info">
                        <div className="player-name-row">
                          <span className="player-char-name">
                            {charName}
                          </span>
                          <span className={`offline-badge ${isOnline ? 'online' : 'offline'}`}>
                            {isOnline ? 'ONLINE' : 'OFFLINE'}
                          </span>
                        </div>

                        <div className="player-sub-meta">
                          {steamName && (
                            <span className="player-steam-tag font-mono" title={`Conta FiveM: ${steamName}`}>
                              {steamName}
                            </span>
                          )}
                          <span className="player-job-tag">
                            {jobLabel}
                          </span>
                          <span className="badge-citizenid font-mono" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                            Slot #{slotNum}
                          </span>
                          <span className="badge-citizenid font-mono">
                            CID: {citizenId}
                          </span>
                        </div>

                        <div className="player-meta font-mono" style={{ gap: '10px' }}>
                          <span title="Saldo Bancário" style={{ color: '#38bdf8' }}>
                            <Coins size={11} weight="fill" /> R$ {Number(bankMoney).toLocaleString('pt-BR')}
                          </span>
                          {gemsMoney > 0 && (
                            <span title="Gemas" style={{ color: '#06b6d4' }}>
                              💎 {Number(gemsMoney).toLocaleString('pt-BR')}
                            </span>
                          )}
                          <span title="Último Acesso" style={{ color: '#64748b' }}>
                            <Clock size={11} /> {formatLastSeen(citizen.lastLoggedOut)}
                          </span>
                        </div>
                      </div>

                      {/* Ações */}
                      <div className="player-actions">
                        <button
                          className="btn-icon"
                          title="Abrir Dossiê & Gerenciamento (Inventário, Banco, Bans)"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenDossier && onOpenDossier(citizen);
                          }}
                        >
                          <User size={16} />
                        </button>

                        {/* Se o cidadão estiver online, permite localizar e telar */}
                        {isOnline && citizen.onlineId && (
                          <>
                            <button
                              className="btn-icon"
                              title="Localizar no mapa"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelect(citizen.onlineId);
                              }}
                            >
                              <Crosshair size={16} />
                            </button>
                            <button
                              className={`btn-icon ${streamingIds.includes(citizen.onlineId) ? 'live' : ''}`}
                              title={streamingIds.includes(citizen.onlineId) ? 'Parar telagem' : 'Telar jogador'}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (streamingIds.includes(citizen.onlineId)) {
                                  onStopStream(citizen.onlineId);
                                } else {
                                  onStartStream(citizen.onlineId);
                                }
                              }}
                            >
                              <Eye size={16} weight={streamingIds.includes(citizen.onlineId) ? 'fill' : 'regular'} />
                            </button>
                          </>
                        )}
                      </div>
                    </Motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </aside>
  );
}
