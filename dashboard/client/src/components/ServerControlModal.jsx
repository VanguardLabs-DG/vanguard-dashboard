/**
 * ServerControlModal.jsx — Central Global de Operações do Servidor
 *
 * Módulo de Controle da Cidade para Staff & Coordenação:
 * - Tab 1: Comunicado Global (Broadcast / Anúncio sonoro & chat in-game)
 * - Tab 2: Clima & Horário (Sincronização em tempo real via GlobalState)
 * - Tab 3: Ledger Central de Banimentos (Visualização, busca e desbanimento de contas)
 *
 * Em total conformidade com DESIGN.md (paleta #090d16, #10b981, sem tons roxos).
 *
 * @module ServerControlModal
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  X,
  MegaphoneSimple,
  CloudSun,
  Prohibit,
  ArrowsClockwise,
  MagnifyingGlass,
  Sun,
  CloudRain,
  CloudLightning,
  CloudFog,
  Snowflake,
  Clock,
  PaperPlaneTilt,
  CheckCircle,
  WarningCircle,
  ShieldWarning,
  Trash,
  User,
  Sparkle,
  HourglassHigh,
  Terminal,
} from '@phosphor-icons/react';
import { getSocket } from '../socket';

const WEATHER_PRESETS = [
  { id: 'EXTRASUNNY', label: 'Ensolarado', icon: Sun, desc: 'Céu aberto, sol forte' },
  { id: 'CLEAR', label: 'Limpo', icon: Sun, desc: 'Dia claro sem nuvens' },
  { id: 'CLOUDS', label: 'Nublado', icon: CloudSun, desc: 'Nuvens moderadas' },
  { id: 'OVERCAST', label: 'Encoberto', icon: CloudSun, desc: 'Céu cinza e denso' },
  { id: 'RAIN', label: 'Chuva', icon: CloudRain, desc: 'Chuva contínua com asfalto molhado' },
  { id: 'THUNDER', label: 'Tempestade', icon: CloudLightning, desc: 'Raios, trovões e chuva torrencial' },
  { id: 'FOGGY', label: 'Neblina', icon: CloudFog, desc: 'Visibilidade baixa na cidade' },
  { id: 'SMOG', label: 'Smog / Névoa', icon: CloudFog, desc: 'Poluição atmosférica' },
  { id: 'SNOW', label: 'Neve', icon: Snowflake, desc: 'Precipitação de neve' },
];

const TIME_PRESETS = [
  { label: 'Madrugada', hour: 1, minute: 0, desc: '01:00' },
  { label: 'Amanhecer', hour: 6, minute: 0, desc: '06:00' },
  { label: 'Meio-Dia', hour: 12, minute: 0, desc: '12:00' },
  { label: 'Tarde', hour: 16, minute: 30, desc: '16:30' },
  { label: 'Pôr do Sol', hour: 18, minute: 45, desc: '18:45' },
  { label: 'Noite', hour: 22, minute: 0, desc: '22:00' },
];

const BROADCAST_PRESETS = [
  { title: 'Aviso Geral', text: 'Aviso da Staff: Mantenham o roleplay limpo e respeitem as regras da cidade.' },
  { title: 'Reinício Programado', text: 'ATENÇÃO: A cidade passará por reinício programado em 15 minutos. Salvem seus veículos!' },
  { title: 'Evento da Cidade', text: 'EVENTO OFICIAL: Novo evento iniciado na praça central! Compareçam para premiações.' },
  { title: 'Alerta de Manutenção', text: 'ALERTA TÉCNICO: Instabilidade temporária detectada. Não abram chamados duplicados.' },
];

export default function ServerControlModal({ initialTab = 'broadcast', onClose }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Tab 1: Broadcast State
  const [broadcastText, setBroadcastText] = useState('');

  // Tab 2: World State
  const [selectedWeather, setSelectedWeather] = useState('EXTRASUNNY');
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);

  // Tab 3: Bans Ledger State
  const [bans, setBans] = useState([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [bansSearch, setBansSearch] = useState('');
  const [unbanTarget, setUnbanTarget] = useState(null);

  // Limpa mensagens após 5 segundos
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // Carrega bans ao alternar para a aba
  const fetchBans = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    setBansLoading(true);
    socket.emit('get_server_bans', {}, (response) => {
      setBansLoading(false);
      if (response && response.success) {
        setBans(response.bans || []);
      } else {
        setStatusMessage({
          type: 'error',
          text: response?.error || 'Erro ao carregar lista de banimentos.',
        });
      }
    });
  }, []);

  useEffect(() => {
    if (activeTab === 'bans') {
      fetchBans();
    }
  }, [activeTab, fetchBans]);

  // Executa Ação Administrativa Global
  const handleExecute = (action, options = {}) => {
    const socket = getSocket();
    if (!socket) {
      setStatusMessage({ type: 'error', text: 'Conexão com a dashboard indisponível.' });
      return;
    }

    setActionLoading(true);
    setStatusMessage(null);

    socket.emit(
      'admin_action',
      {
        action,
        targetPlayerId: 0,
        options,
      },
      (res) => {
        setActionLoading(false);
        if (res && res.success) {
          setStatusMessage({
            type: 'success',
            text: res.message || 'Comando global executado com sucesso!',
          });
          if (action === 'broadcast') {
            setBroadcastText('');
          }
          if (action === 'revoke_ban') {
            setUnbanTarget(null);
            fetchBans();
          }
        } else {
          setStatusMessage({
            type: 'error',
            text: res?.error || 'Falha ao executar comando global.',
          });
        }
      }
    );
  };

  // Filtragem de Bans
  const filteredBans = useMemo(() => {
    if (!bansSearch.trim()) return bans;
    const q = bansSearch.toLowerCase();
    return bans.filter((b) => {
      const name = (b.name || '').toLowerCase();
      const reason = (b.reason || '').toLowerCase();
      const bannedby = (b.bannedby || '').toLowerCase();
      const license = (b.license || '').toLowerCase();
      const discord = (b.discord || '').toLowerCase();
      const id = String(b.id || '');
      return (
        name.includes(q) ||
        reason.includes(q) ||
        bannedby.includes(q) ||
        license.includes(q) ||
        discord.includes(q) ||
        id.includes(q)
      );
    });
  }, [bans, bansSearch]);

  const formatBanExpire = (expireEpoch) => {
    if (!expireEpoch || expireEpoch >= 2147483647) return 'Permanente';
    try {
      const d = new Date(expireEpoch * 1000);
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_e) {
      return 'Expiração Indefinida';
    }
  };

  return (
    <div className="dossier-backdrop" onClick={onClose}>
      <Motion.div
        className="dossier-modal server-control-modal"
        style={{ maxWidth: '820px' }}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        {/* Header */}
        <div className="dossier-header">
          <div className="dossier-title-group">
            <div
              className="dossier-avatar"
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: 'var(--color-primary, #10b981)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              <Terminal size={22} weight="bold" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 className="dossier-name">Controle Central do Servidor</h2>
                <span className="dossier-badge-state alive">GLOBAL OPERATIONS</span>
              </div>
              <p className="dossier-subname">
                Operações de mundo, anúncios in-game e gestão central de punições
              </p>
            </div>
          </div>

          <button className="btn-icon" onClick={onClose} title="Fechar (ESC)">
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Status Feedback Banner */}
        <AnimatePresence>
          {statusMessage && (
            <Motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={`dossier-status-bar ${statusMessage.type === 'error' ? 'status-err' : 'status-ok'}`}
              style={{
                margin: '12px 20px 0 20px',
                padding: '10px 14px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.82rem',
                background: statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                border: `1px solid ${statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                color: statusMessage.type === 'error' ? '#ef4444' : '#10b981',
              }}
            >
              {statusMessage.type === 'error' ? <WarningCircle size={16} weight="bold" /> : <CheckCircle size={16} weight="bold" />}
              <span>{statusMessage.text}</span>
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Navegação por Abas */}
        <div className="dossier-tabs" style={{ padding: '0 20px' }}>
          <button
            className={`dossier-tab ${activeTab === 'broadcast' ? 'active' : ''}`}
            onClick={() => setActiveTab('broadcast')}
          >
            <MegaphoneSimple size={16} weight="bold" />
            <span>Comunicado Global</span>
          </button>
          <button
            className={`dossier-tab ${activeTab === 'world' ? 'active' : ''}`}
            onClick={() => setActiveTab('world')}
          >
            <CloudSun size={16} weight="bold" />
            <span>Clima & Horário</span>
          </button>
          <button
            className={`dossier-tab ${activeTab === 'bans' ? 'active' : ''}`}
            onClick={() => setActiveTab('bans')}
          >
            <Prohibit size={16} weight="bold" />
            <span>Registro de Bans ({bans.length})</span>
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="dossier-body" style={{ minHeight: '360px', maxHeight: '540px' }}>
          {/* TAB 1: COMUNICADO GLOBAL (BROADCAST) */}
          {activeTab === 'broadcast' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <h4 style={{ fontSize: '0.9rem', color: '#f8fafc', marginBottom: '4px', fontWeight: 600 }}>
                  Transmissão de Anúncio In-Game
                </h4>
                <p style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                  Envia um aviso com alerta sonoro e notificação prioritária (ox_lib) + mensagem destacada no chat de todos os cidadãos online.
                </p>
              </div>

              {/* Presets Rápidos */}
              <div>
                <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px' }}>
                  Modelos Prontos:
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginTop: '6px' }}>
                  {BROADCAST_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      className="preset-broadcast-card"
                      onClick={() => setBroadcastText(preset.text)}
                    >
                      <span className="preset-card-title">{preset.title}</span>
                      <span className="preset-card-text">
                        {preset.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Textarea do Anúncio */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 600 }}>
                  Mensagem do Comunicado:
                </label>
                <textarea
                  className="mod-input-text"
                  rows={4}
                  placeholder="Digite a mensagem que será enviada para toda a cidade..."
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  style={{ resize: 'vertical', width: '100%' }}
                />
              </div>

              {/* Preview In-Game */}
              {broadcastText.trim() && (
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px dashed rgba(245, 158, 11, 0.4)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700, letterSpacing: '0.5px' }}>
                    PRÉVIA DA NOTIFICAÇÃO (OX_LIB):
                  </span>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '4px' }}>
                    <MegaphoneSimple size={18} color="#f59e0b" weight="fill" />
                    <div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                        📢 COMUNICADO DA ADMINISTRAÇÃO
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#cbd5e1', marginTop: '2px' }}>
                        {broadcastText}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Botão de Envio */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  className="btn-veh-action"
                  disabled={actionLoading || !broadcastText.trim()}
                  onClick={() => handleExecute('broadcast', { message: broadcastText })}
                  style={{
                    background: 'var(--color-primary, #10b981)',
                    borderColor: 'var(--color-primary, #10b981)',
                    color: '#090d16',
                    fontWeight: 700,
                    padding: '10px 20px',
                    fontSize: '0.84rem',
                  }}
                >
                  <PaperPlaneTilt size={16} weight="bold" />
                  <span>{actionLoading ? 'Transmitindo...' : 'Transmitir para Toda a Cidade'}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: CLIMA & HORÁRIO (WORLD CONTROL) */}
          {activeTab === 'world' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              {/* Seção 1: Clima */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ fontSize: '0.9rem', color: '#f8fafc', fontWeight: 600 }}>Controle Atmosférico</h4>
                    <p style={{ fontSize: '0.76rem', color: '#94a3b8' }}>Sincroniza o clima global da cidade via Renewed-Weathersync</p>
                  </div>
                  <button
                    className="inv-action-btn"
                    disabled={actionLoading}
                    onClick={() => handleExecute('set_weather', { weather: selectedWeather })}
                    style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#10b981' }}
                  >
                    <CheckCircle size={14} weight="bold" />
                    <span>Aplicar Clima: {selectedWeather}</span>
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                  {WEATHER_PRESETS.map((w) => {
                    const IconComp = w.icon;
                    const isSel = selectedWeather === w.id;
                    return (
                      <div
                        key={w.id}
                        onClick={() => setSelectedWeather(w.id)}
                        style={{
                          background: isSel ? 'rgba(16, 185, 129, 0.15)' : 'var(--color-surface, #0e1524)',
                          border: `1px solid ${isSel ? 'var(--color-primary, #10b981)' : 'var(--color-border, rgba(148, 163, 184, 0.15))'}`,
                          borderRadius: '8px',
                          padding: '10px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <IconComp size={16} color={isSel ? '#10b981' : '#94a3b8'} weight={isSel ? 'fill' : 'bold'} />
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isSel ? '#10b981' : '#f8fafc' }}>
                            {w.label}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.68rem', color: '#64748b' }}>{w.desc}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Seção 2: Horário */}
              <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.12)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ fontSize: '0.9rem', color: '#f8fafc', fontWeight: 600 }}>Sincronização de Relógio</h4>
                    <p style={{ fontSize: '0.76rem', color: '#94a3b8' }}>Ajusta o horário oficial em GlobalState.currentTime</p>
                  </div>
                  <button
                    className="inv-action-btn"
                    disabled={actionLoading}
                    onClick={() => handleExecute('set_time', { hour, minute })}
                    style={{ background: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.4)', color: '#38bdf8' }}
                  >
                    <Clock size={14} weight="bold" />
                    <span>Aplicar {String(hour).padStart(2, '0')}:{String(minute).padStart(2, '0')}</span>
                  </button>
                </div>

                {/* Presets Rápidos de Horário */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                  {TIME_PRESETS.map((t, idx) => (
                    <button
                      key={idx}
                      className="inv-action-btn"
                      style={{ padding: '6px 12px', fontSize: '0.74rem' }}
                      onClick={() => {
                        setHour(t.hour);
                        setMinute(t.minute);
                      }}
                    >
                      <Clock size={13} />
                      <span>{t.label} ({t.desc})</span>
                    </button>
                  ))}
                </div>

                {/* Sliders de Hora e Minuto */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', background: 'rgba(15, 23, 42, 0.4)', padding: '12px', borderRadius: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: '#94a3b8', marginBottom: '4px' }}>
                      <span>Horas</span>
                      <strong style={{ color: '#f8fafc', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {String(hour).padStart(2, '0')}h
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={23}
                      value={hour}
                      onChange={(e) => setHour(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--color-primary, #10b981)' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.76rem', color: '#94a3b8', marginBottom: '4px' }}>
                      <span>Minutos</span>
                      <strong style={{ color: '#f8fafc', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {String(minute).padStart(2, '0')}m
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={59}
                      value={minute}
                      onChange={(e) => setMinute(Number(e.target.value))}
                      style={{ width: '100%', accentColor: 'var(--color-primary, #10b981)' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: REGISTRO GERAL DE BANIMENTOS (BANS LEDGER) */}
          {activeTab === 'bans' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Barra de Filtro e Atualização */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <MagnifyingGlass
                    size={16}
                    style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
                  />
                  <input
                    type="text"
                    className="mod-input-text"
                    placeholder="Filtrar por nome, motivo, licença, discord ou staff..."
                    value={bansSearch}
                    onChange={(e) => setBansSearch(e.target.value)}
                    style={{ paddingLeft: '32px', width: '100%' }}
                  />
                </div>

                <button
                  className="inv-action-btn"
                  onClick={fetchBans}
                  disabled={bansLoading}
                  title="Atualizar Lista de Banimentos"
                  style={{ height: '36px', padding: '0 14px' }}
                >
                  <ArrowsClockwise size={15} className={bansLoading ? 'spin-icon' : ''} />
                  <span>Atualizar</span>
                </button>
              </div>

              {/* Tabela / Lista de Bans */}
              {bansLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', color: '#94a3b8', gap: '8px' }}>
                  <ArrowsClockwise size={20} className="spin-icon" />
                  <span>Carregando banimentos da base de dados...</span>
                </div>
              ) : filteredBans.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '220px', color: '#64748b', gap: '6px' }}>
                  <CheckCircle size={32} color="#10b981" weight="duotone" />
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    {bansSearch ? 'Nenhum banimento corresponde ao filtro de busca.' : 'Nenhum banimento ativo registrado no momento.'}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '420px', paddingRight: '4px' }}>
                  {filteredBans.map((ban) => {
                    const isTarget = unbanTarget === ban.id;
                    return (
                      <div
                        key={ban.id || ban.license}
                        style={{
                          background: 'var(--color-surface, #0e1524)',
                          border: '1px solid var(--color-border, rgba(148, 163, 184, 0.15))',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: 700, color: '#ef4444', fontSize: '0.88rem' }}>
                                #{ban.id} — {ban.name || 'Cidadão Indefinido'}
                              </span>
                              <span
                                style={{
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: ban.expire >= 2147483647 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                  color: ban.expire >= 2147483647 ? '#ef4444' : '#f59e0b',
                                }}
                              >
                                {formatBanExpire(ban.expire)}
                              </span>
                            </div>

                            <p style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '3px', fontWeight: 500 }}>
                              <strong>Motivo:</strong> {ban.reason || 'Sem motivo registrado'}
                            </p>
                          </div>

                          {/* Botão de Revogação de Ban */}
                          <div>
                            {!isTarget ? (
                              <button
                                className="item-delete-btn"
                                onClick={() => setUnbanTarget(ban.id)}
                                title="Revogar Punição (Desbanir)"
                                style={{
                                  background: 'rgba(239, 68, 68, 0.12)',
                                  borderColor: 'rgba(239, 68, 68, 0.3)',
                                  color: '#ef4444',
                                  padding: '5px 10px',
                                  fontSize: '0.74rem',
                                }}
                              >
                                <Trash size={14} />
                                <span>Revogar</span>
                              </button>
                            ) : (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button
                                  className="inv-action-btn"
                                  onClick={() => setUnbanTarget(null)}
                                  style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                                >
                                  Cancelar
                                </button>
                                <button
                                  className="btn-ban"
                                  disabled={actionLoading}
                                  onClick={() => handleExecute('revoke_ban', { identifier: ban.id || ban.license })}
                                  style={{ padding: '4px 10px', fontSize: '0.72rem', background: '#10b981', borderColor: '#10b981', color: '#090d16' }}
                                >
                                  Confirmar Desban
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Metadados do Ban */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.7rem', color: '#64748b', borderTop: '1px dashed rgba(148, 163, 184, 0.1)', paddingTop: '6px' }}>
                          <span><strong>Aplicado por:</strong> {ban.bannedby || 'Staff'}</span>
                          {ban.license && (
                            <span style={{ fontFamily: 'monospace' }}>
                              <strong>Licença:</strong> {ban.license.slice(0, 24)}...
                            </span>
                          )}
                          {ban.discord && (
                            <span style={{ fontFamily: 'monospace' }}>
                              <strong>Discord:</strong> {ban.discord}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </Motion.div>
    </div>
  );
}
