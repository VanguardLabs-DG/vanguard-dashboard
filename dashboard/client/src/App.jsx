/**
 * App.jsx — Root application component for Vanguard Dashboard.
 *
 * Pilares Integrados:
 * - Pilar 1: Telagem Avançada, Matriz CCTV / Multi-Stream Split Screen, Auditoria de Staff
 * - Pilar 2: Dossiê Completo do Cidadão (QBX Core) e Inventário em Tempo Real (ox_inventory)
 * - Pilar 3: Moderação 1-Clique Remota integrada aos modais e streams
 *
 * @module App
 */

import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  Eye,
  WifiHigh,
  WifiSlash,
  List,
  Scroll,
  SquaresFour,
  Broadcast,
} from '@phosphor-icons/react';

import LoginScreen from './components/LoginScreen';
import PlayerList from './components/PlayerList';
import GameMap from './components/GameMap';
import LiveStream from './components/LiveStream';
import PlayerDossierModal from './components/PlayerDossierModal';
import AuditLogsModal from './components/AuditLogsModal';
import { connectSocket, getSocket, disconnectSocket } from './socket';

export default function App() {
  // ─── Auth State ────────────────────────────────────────────
  const [token, setToken] = useState(() => localStorage.getItem('fivem-watch-token'));
  const [isConnected, setIsConnected] = useState(false);

  // ─── Data State ────────────────────────────────────────────
  const [players, setPlayers] = useState([]);

  // ─── UI State ──────────────────────────────────────────────
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [streamingPlayerIds, setStreamingPlayerIds] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isGridMode, setIsGridMode] = useState(false);

  // Modais
  const [dossierPlayerId, setDossierPlayerId] = useState(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [hasNewAuditLogs, setHasNewAuditLogs] = useState(false);

  // ─── Socket Connection ─────────────────────────────────────
  useEffect(() => {
    if (!token) return;

    const socket = connectSocket(token);

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('players_update', (data) => {
      setPlayers(data);
    });

    socket.on('server_offline', () => {
      setPlayers([]);
    });

    socket.on('audit_log_entry', () => {
      if (!isAuditModalOpen) {
        setHasNewAuditLogs(true);
      }
    });

    socket.on('auth_error', () => {
      localStorage.removeItem('fivem-watch-token');
      setToken(null);
      disconnectSocket();
    });

    socket.on('stream_error', (data) => {
      console.error('[vanguard_dashboard] Erro de telagem:', data.error);
      alert(`Erro na Telagem (Player #${data.playerId}): ${data.error}`);
      setStreamingPlayerIds((prev) => prev.filter((id) => id !== data.playerId));
    });

    return () => {
      disconnectSocket();
    };
  }, [token, isAuditModalOpen]);

  // ─── Auth Handlers ─────────────────────────────────────────
  const handleLogin = useCallback((newToken) => {
    localStorage.setItem('fivem-watch-token', newToken);
    setToken(newToken);
  }, []);

  // ─── Stream Handlers ───────────────────────────────────────
  const handleStartStream = useCallback((playerId) => {
    const socket = getSocket();
    if (!socket) return;

    setStreamingPlayerIds((prev) => {
      if (prev.includes(playerId)) return prev;
      socket.emit('start_stream', playerId);
      return [...prev, playerId];
    });
  }, []);

  const handleStopStream = useCallback((playerId) => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('stop_stream', playerId);
    setStreamingPlayerIds((prev) => prev.filter((id) => id !== playerId));
  }, []);

  const dossierPlayer = players.find((p) => p.id === dossierPlayerId);

  // ─── Not Authenticated — Show Login ────────────────────────
  if (!token) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // ─── Main Dashboard ────────────────────────────────────────
  return (
    <div className={`app-shell ${!isSidebarOpen ? 'sidebar-hidden' : ''}`}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-brand" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            className="btn-icon"
            style={{ margin: '-8px 0', opacity: 0.8 }}
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title="Alternar Barra Lateral"
          >
            <List size={20} weight="bold" />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="dot" />
            <span style={{ fontWeight: 700, letterSpacing: '0.5px' }}>
              Vanguard <span style={{ color: 'var(--color-accent)', fontWeight: 500 }}>Dashboard</span>
            </span>
          </div>
        </div>

        <div className="header-status">
          {/* Botão de Auditoria / Histórico de Staff (Pilar 1) */}
          <button
            className={`btn-header-tool ${hasNewAuditLogs ? 'has-badge' : ''}`}
            onClick={() => {
              setIsAuditModalOpen(true);
              setHasNewAuditLogs(false);
            }}
            title="Ver Histórico de Auditoria e Ações da Staff"
          >
            <Scroll size={16} weight="bold" />
            <span>Auditoria</span>
            {hasNewAuditLogs && <span className="header-notify-dot" />}
          </button>

          {/* Alternar Modo Matriz CCTV / Multi-Stream Grid */}
          {streamingPlayerIds.length > 1 && (
            <button
              className={`btn-header-tool ${isGridMode ? 'active' : ''}`}
              onClick={() => setIsGridMode(!isGridMode)}
              title="Alternar visualização em Grade CCTV"
            >
              <SquaresFour size={16} weight={isGridMode ? 'fill' : 'bold'} />
              <span>Matriz CCTV</span>
            </button>
          )}

          {/* Badge de Telagens Ativas */}
          {streamingPlayerIds.length > 0 && (
            <span
              className="status-badge live-badge"
              style={{ cursor: 'pointer' }}
              onClick={() => streamingPlayerIds.forEach(handleStopStream)}
              title="Clique para encerrar todas as transmissões"
            >
              <Broadcast size={14} weight="fill" />
              Telando {streamingPlayerIds.length} {streamingPlayerIds.length === 1 ? 'player' : 'players'}
            </span>
          )}

          {/* Status da Conexão */}
          <span className={`status-badge ${isConnected ? '' : 'offline'}`}>
            {isConnected ? (
              <>
                <WifiHigh size={12} weight="bold" />
                {players.length} online
              </>
            ) : (
              <>
                <WifiSlash size={12} weight="bold" />
                Desconectado
              </>
            )}
          </span>
        </div>
      </header>

      {/* ── Sidebar — Lista de Jogadores ─────────────────────── */}
      {isSidebarOpen && (
        <PlayerList
          players={players}
          selectedId={selectedPlayerId}
          streamingIds={streamingPlayerIds}
          onSelect={setSelectedPlayerId}
          onStartStream={handleStartStream}
          onStopStream={handleStopStream}
          onOpenDossier={(pid) => setDossierPlayerId(pid)}
        />
      )}

      {/* ── Main — Mapa & Overlays de Telagem ────────────────── */}
      <main className="app-main">
        <GameMap players={players} focusPlayerId={selectedPlayerId} />

        {/* ── Modo Matriz CCTV Grid (Multi-Stream) ─────────────── */}
        {isGridMode && streamingPlayerIds.length > 0 ? (
          <div className={`cctv-grid-overlay count-${Math.min(4, streamingPlayerIds.length)}`}>
            {streamingPlayerIds.map((playerId, index) => {
              const player = players.find((p) => p.id === playerId);
              return (
                <LiveStream
                  key={playerId}
                  playerId={playerId}
                  playerName={player?.characterName || player?.name}
                  indexOffset={index}
                  isGridMode={true}
                  onClose={() => handleStopStream(playerId)}
                  onOpenDossier={(pid) => setDossierPlayerId(pid)}
                />
              );
            })}
          </div>
        ) : (
          /* ── Modo Janelas Flutuantes (PiP) ─────────────────── */
          <AnimatePresence>
            {streamingPlayerIds.map((playerId, index) => {
              const player = players.find((p) => p.id === playerId);
              return (
                <LiveStream
                  key={playerId}
                  playerId={playerId}
                  playerName={player?.characterName || player?.name}
                  indexOffset={index}
                  isGridMode={false}
                  onClose={() => handleStopStream(playerId)}
                  onOpenDossier={(pid) => setDossierPlayerId(pid)}
                />
              );
            })}
          </AnimatePresence>
        )}
      </main>

      {/* ── Modal de Dossiê do Cidadão & Inventário (Pilar 2 & 3) ── */}
      <AnimatePresence>
        {dossierPlayerId && dossierPlayer && (
          <PlayerDossierModal
            player={dossierPlayer}
            onClose={() => setDossierPlayerId(null)}
            onStartStream={handleStartStream}
            isStreaming={streamingPlayerIds.includes(dossierPlayerId)}
          />
        )}
      </AnimatePresence>

      {/* ── Modal de Auditoria e Logs de Staff (Pilar 1) ────────── */}
      <AnimatePresence>
        {isAuditModalOpen && (
          <AuditLogsModal onClose={() => setIsAuditModalOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
