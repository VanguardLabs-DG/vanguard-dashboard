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
  User,
  SignOut,
  Key,
  UsersThree,
} from '@phosphor-icons/react';

import LoginScreen from './components/LoginScreen';
import PlayerList from './components/PlayerList';
import GameMap from './components/GameMap';
import LiveStream from './components/LiveStream';
import PlayerDossierModal from './components/PlayerDossierModal';
import AuditLogsModal from './components/AuditLogsModal';
import ChangePasswordModal from './components/ChangePasswordModal';
import StaffManagementModal from './components/StaffManagementModal';
import ErrorBoundary from './components/ErrorBoundary';
import { connectSocket, getSocket, disconnectSocket } from './socket';

export default function App() {
  // ─── Auth State ────────────────────────────────────────────
  const [token, setToken] = useState(() => {
    const savedToken = localStorage.getItem('fivem-watch-token');
    const savedUser = localStorage.getItem('fivem-watch-user');
    // Força desautenticação de sessões antigas que usavam o secret bruto sem perfil
    if (savedToken && (!savedUser || !savedToken.includes('.'))) {
      localStorage.removeItem('fivem-watch-token');
      localStorage.removeItem('fivem-watch-user');
      return null;
    }
    return savedToken;
  });
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('fivem-watch-user');
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  });
  const [isConnected, setIsConnected] = useState(false);

  // Modais de Gestão e Segurança
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

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
      localStorage.removeItem('fivem-watch-user');
      setToken(null);
      setUser(null);
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
  const handleLogin = useCallback((newToken, newUser) => {
    localStorage.setItem('fivem-watch-token', newToken);
    setToken(newToken);
    if (newUser) {
      localStorage.setItem('fivem-watch-user', JSON.stringify(newUser));
      setUser(newUser);
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('fivem-watch-token');
    localStorage.removeItem('fivem-watch-user');
    setToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  const handlePasswordUpdated = useCallback((newToken, updatedUser) => {
    localStorage.setItem('fivem-watch-token', newToken);
    setToken(newToken);
    if (updatedUser) {
      localStorage.setItem('fivem-watch-user', JSON.stringify(updatedUser));
      setUser(updatedUser);
    }
    setIsChangePasswordModalOpen(false);
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

          {/* Gestão de Equipe (SuperAdmin / Dege) */}
          {user?.role === 'superadmin' && (
            <button
              className="btn-header-tool"
              onClick={() => setIsStaffModalOpen(true)}
              title="Gerenciar Equipe de Staff e Redefinir Senhas"
            >
              <UsersThree size={16} weight="bold" />
              <span>Equipe</span>
            </button>
          )}

          {/* Badge de Perfil do Operador Logado */}
          {user && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px 4px 10px',
                background: 'var(--color-surface, #0e1524)',
                border: '1px solid var(--color-border, rgba(148, 163, 184, 0.15))',
                borderRadius: 'var(--radius-sm, 6px)',
                fontSize: '0.8rem',
              }}
            >
              <User
                size={14}
                weight="bold"
                style={{ color: user.role === 'superadmin' ? '#10b981' : '#38bdf8' }}
              />
              <span style={{ fontWeight: 600, color: 'var(--color-text, #f8fafc)' }}>
                {user.displayName || user.username}
              </span>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '3px',
                  background: user.role === 'superadmin' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                  color: user.role === 'superadmin' ? '#10b981' : '#38bdf8',
                  letterSpacing: '0.3px',
                }}
              >
                {user.role === 'superadmin' ? 'SUPERADMIN' : 'ADM'}
              </span>

              <button
                className="btn-icon"
                onClick={() => setIsChangePasswordModalOpen(true)}
                title="Alterar Minha Senha"
                style={{ width: '24px', height: '24px', padding: 0, marginLeft: '2px' }}
              >
                <Key size={13} />
              </button>

              <button
                className="btn-icon"
                onClick={handleLogout}
                title="Sair do Painel"
                style={{ width: '24px', height: '24px', padding: 0 }}
              >
                <SignOut size={13} />
              </button>
            </div>
          )}
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
          <ErrorBoundary
            title="Erro no Módulo de Auditoria"
            message="Não foi possível renderizar os registros de auditoria devido a uma inconsistência nos dados recebidos. O painel principal continua ativo."
            onReset={() => setIsAuditModalOpen(false)}
          >
            <AuditLogsModal onClose={() => setIsAuditModalOpen(false)} />
          </ErrorBoundary>
        )}
      </AnimatePresence>

      {/* ── Modal de Gestão de Equipe (SuperAdmin) ─────────────── */}
      <AnimatePresence>
        {isStaffModalOpen && (
          <StaffManagementModal
            token={token}
            onClose={() => setIsStaffModalOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Modal de Troca de Senha (Obrigatório ou Voluntário) ─── */}
      <AnimatePresence>
        {(user?.mustChangePassword || isChangePasswordModalOpen) && (
          <ChangePasswordModal
            token={token}
            user={user}
            isMandatory={Boolean(user?.mustChangePassword)}
            onClose={() => setIsChangePasswordModalOpen(false)}
            onSuccess={handlePasswordUpdated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
