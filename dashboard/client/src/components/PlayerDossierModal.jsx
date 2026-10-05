/**
 * PlayerDossierModal.jsx — Dossiê Completo do Cidadão, Inventário em Tempo Real e Moderação Remota
 *
 * Pilares atendidos:
 * - Pilar 2: Integração RP (QBX Core: identidade, emprego, facção, dinheiro; ox_inventory: itens, peso, slots; OneSync: veículo)
 * - Pilar 3: Ações Administrativas Remotas com 1 Clique (Freeze, Revive, Heal, Teleport, Warn, Kick)
 *
 * @module PlayerDossierModal
 */

import { useState, useEffect } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  X,
  User,
  Backpack,
  ShieldWarning,
  Heart,
  Shield,
  Coins,
  Briefcase,
  UsersThree,
  Phone,
  Car,
  Speedometer,
  Gauge,
  ArrowsClockwise,
  Snowflake,
  FirstAid,
  Bandaids,
  PaperPlaneTilt,
  Prohibit,
  MapPin,
  Eye,
  MagnifyingGlass,
  CheckCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import { getSocket } from '../socket';

const PREDEFINED_LOCATIONS = [
  { label: 'Praça Central', x: 155.0, y: -1004.0, z: 29.4 },
  { label: 'Hospital Geral', x: 298.5, y: -584.5, z: 43.3 },
  { label: 'Sala de Telagem / Staff', x: 215.7, y: -810.0, z: 30.7 },
  { label: 'Delegacia Principal', x: 425.1, y: -979.5, z: 30.7 },
  { label: 'Aeroporto LS', x: -1037.6, y: -2737.8, z: 13.8 },
];

const QUICK_WARN_PRESETS = [
  'Favor comparecer à sala de suporte no Discord.',
  'Aviso de Moderação: Mantenha a conduta e as regras de RP.',
  'Você está sob análise da administração. Não saia da cidade.',
  'Atenção: Proibido anti-RP ou quebra de imersão nesta área.',
];

const QUICK_KICK_REASONS = [
  'Anti-RP / Quebra de regras',
  'Combat Logging (desconectar em ação)',
  'Uso indevido de bugs ou exploits',
  'Comportamento tóxico com outros jogadores',
  'Ajuste de inventário / Relogar para sync',
];

export default function PlayerDossierModal({
  player,
  onClose,
  onStartStream,
  isStreaming,
}) {
  const [activeTab, setActiveTab] = useState('dossier'); // 'dossier' | 'inventory' | 'moderation'
  const [inventoryData, setInventoryData] = useState(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Inputs de ações
  const [warnMessage, setWarnMessage] = useState('');
  const [kickReason, setKickReason] = useState('');
  const [customCoords, setCustomCoords] = useState({ x: '', y: '', z: '' });

  // Busca dados do ox_inventory quando a aba de inventário é acessada
  const fetchInventory = () => {
    if (!player?.id) return;
    setInvLoading(true);
    const socket = getSocket();
    if (!socket) {
      setInvLoading(false);
      return;
    }

    socket.emit('get_player_inventory', { playerId: player.id }, (response) => {
      setInvLoading(false);
      if (response && response.success) {
        setInventoryData(response.inventory);
      } else {
        setStatusMessage({
          type: 'error',
          text: response?.error || 'Erro ao carregar ox_inventory.',
        });
      }
    });
  };

  useEffect(() => {
    if (activeTab === 'inventory') {
      fetchInventory();
    }
  }, [activeTab, player?.id]);

  // Executa uma ação administrativa remota (Pilar 3)
  const handleAdminAction = (action, options = {}) => {
    if (!player?.id) return;
    const socket = getSocket();
    if (!socket) {
      setStatusMessage({ type: 'error', text: 'Sem conexão com o servidor.' });
      return;
    }

    setActionLoading(true);
    setStatusMessage(null);

    socket.emit(
      'admin_action',
      {
        action,
        targetPlayerId: player.id,
        options,
        adminName: 'Operador Vanguard',
      },
      (response) => {
        setActionLoading(false);
        if (response && response.success) {
          setStatusMessage({
            type: 'success',
            text: response.message || 'Ação executada com sucesso!',
          });
          if (action === 'warn') setWarnMessage('');
          if (action === 'kick') {
            setKickReason('');
            setTimeout(onClose, 2000);
          }
        } else {
          setStatusMessage({
            type: 'error',
            text: response?.error || 'Falha ao executar ação administrativa.',
          });
        }
      }
    );
  };

  if (!player) return null;

  const dossier = player.dossier || {};
  const vehicle = player.vehicle;
  const isFrozen = Boolean(player.isFrozen);

  // Filtro de itens no inventário
  const filteredItems = (inventoryData?.items || []).filter((item) => {
    const q = invSearch.toLowerCase();
    return (
      (item.label && item.label.toLowerCase().includes(q)) ||
      (item.name && item.name.toLowerCase().includes(q))
    );
  });

  return (
    <div className="dossier-backdrop" onClick={onClose}>
      <Motion.div
        className="dossier-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      >
        {/* Cabeçalho do Modal */}
        <div className="dossier-header">
          <div className="dossier-header-left">
            <div className="dossier-avatar">#{player.id}</div>
            <div className="dossier-titles">
              <div className="dossier-char-name">
                {player.characterName || player.name}
              </div>
              <div className="dossier-sub-name">
                Steam: <span className="font-mono">{player.steamName || player.name}</span>
                {dossier.citizenid && dossier.citizenid !== 'N/A' && (
                  <span className="badge-citizenid">CID: {dossier.citizenid}</span>
                )}
              </div>
            </div>
          </div>

          <div className="dossier-header-actions">
            <button
              className={`btn-dossier-stream ${isStreaming ? 'active' : ''}`}
              onClick={() => onStartStream && onStartStream(player.id)}
              title={isStreaming ? 'Stream em andamento' : 'Iniciar telagem ao vivo'}
            >
              <Eye size={16} weight={isStreaming ? 'fill' : 'bold'} />
              <span>{isStreaming ? 'Telando' : 'Telar'}</span>
            </button>
            <button className="btn-icon" onClick={onClose} title="Fechar Dossiê">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Notificação de Status */}
        <AnimatePresence>
          {statusMessage && (
            <Motion.div
              className={`dossier-status-bar ${statusMessage.type}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle size={18} weight="fill" />
              ) : (
                <WarningCircle size={18} weight="fill" />
              )}
              <span>{statusMessage.text}</span>
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Abas de Navegação */}
        <div className="dossier-tabs">
          <button
            className={`dossier-tab ${activeTab === 'dossier' ? 'active' : ''}`}
            onClick={() => setActiveTab('dossier')}
          >
            <User size={16} weight="bold" />
            <span>Dossiê RP</span>
          </button>
          <button
            className={`dossier-tab ${activeTab === 'inventory' ? 'active' : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            <Backpack size={16} weight="bold" />
            <span>Inventário</span>
            {inventoryData?.items?.length ? (
              <span className="tab-badge">{inventoryData.items.length}</span>
            ) : null}
          </button>
          <button
            className={`dossier-tab ${activeTab === 'moderation' ? 'active' : ''}`}
            onClick={() => setActiveTab('moderation')}
          >
            <ShieldWarning size={16} weight="bold" />
            <span>Moderação 1-Clique</span>
            {isFrozen && <span className="tab-badge danger">FROZEN</span>}
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="dossier-body">
          {/* ════ ABA 1: DOSSIÊ DO CIDADÃO (PILAR 2) ════ */}
          {activeTab === 'dossier' && (
            <div className="dossier-tab-content">
              {/* Barra de Status Vitais */}
              <div className="dossier-card-grid">
                <div className="dossier-stat-card">
                  <div className="dossier-stat-label">
                    <Heart size={16} weight="fill" className="text-danger" />
                    <span>Saúde (HP)</span>
                  </div>
                  <div className="dossier-stat-value font-mono">
                    {player.health ?? 0} / 100
                  </div>
                  <div className="dossier-stat-bar-track">
                    <div
                      className="dossier-stat-bar-fill health"
                      style={{ width: `${Math.min(100, Math.max(0, player.health ?? 0))}%` }}
                    />
                  </div>
                </div>

                <div className="dossier-stat-card">
                  <div className="dossier-stat-label">
                    <Shield size={16} weight="fill" style={{ color: '#38bdf8' }} />
                    <span>Colete (Armour)</span>
                  </div>
                  <div className="dossier-stat-value font-mono">
                    {player.armor ?? 0} / 100
                  </div>
                  <div className="dossier-stat-bar-track">
                    <div
                      className="dossier-stat-bar-fill armor"
                      style={{ width: `${Math.min(100, Math.max(0, player.armor ?? 0))}%` }}
                    />
                  </div>
                </div>

                <div className="dossier-stat-card">
                  <div className="dossier-stat-label">
                    <Coins size={16} weight="fill" className="text-accent" />
                    <span>Carteira</span>
                  </div>
                  <div className="dossier-stat-value text-accent font-mono">
                    R$ {(dossier.money?.cash ?? 0).toLocaleString('pt-BR')}
                  </div>
                  <div className="dossier-stat-sub">
                    Banco: R$ {(dossier.money?.bank ?? 0).toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>

              {/* Informações de Trabalho e Organização */}
              <div className="dossier-section">
                <h3>Ocupação & Envolvimento</h3>
                <div className="dossier-info-grid">
                  <div className="dossier-info-item">
                    <Briefcase size={18} className="text-secondary" />
                    <div>
                      <div className="dossier-info-label">Emprego / Trabalho</div>
                      <div className="dossier-info-val">
                        {dossier.job?.label || 'Desempregado'} —{' '}
                        <span className="text-secondary">
                          {dossier.job?.gradeName || 'Nenhum'}
                        </span>
                        {dossier.job?.onduty && (
                          <span className="badge-duty">EM SERVIÇO</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="dossier-info-item">
                    <UsersThree size={18} className="text-secondary" />
                    <div>
                      <div className="dossier-info-label">Facção / Organização</div>
                      <div className="dossier-info-val">
                        {dossier.gang?.label || 'Nenhuma'} —{' '}
                        <span className="text-secondary">
                          {dossier.gang?.gradeName || 'Membro'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="dossier-info-item">
                    <Phone size={18} className="text-secondary" />
                    <div>
                      <div className="dossier-info-label">Telefone</div>
                      <div className="dossier-info-val font-mono">
                        {dossier.phone || 'Sem registro'}
                      </div>
                    </div>
                  </div>

                  <div className="dossier-info-item">
                    <MapPin size={18} className="text-secondary" />
                    <div>
                      <div className="dossier-info-label">Coordenadas Atuais</div>
                      <div className="dossier-info-val font-mono text-secondary">
                        X: {player.x?.toFixed(1)}, Y: {player.y?.toFixed(1)}, Z: {player.z?.toFixed(1)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Telemetria Veicular (OneSync) */}
              <div className="dossier-section">
                <h3>Telemetria de Veículo (OneSync)</h3>
                {vehicle?.inVehicle ? (
                  <div className="vehicle-telemetry-card">
                    <div className="vehicle-plate-badge">
                      <div className="plate-flag">BRASIL</div>
                      <div className="plate-text">{vehicle.plate || 'ABC-1234'}</div>
                    </div>

                    <div className="vehicle-metrics">
                      <div className="metric-box">
                        <Speedometer size={20} className="text-accent" />
                        <div>
                          <div className="metric-label">Velocidade</div>
                          <div className="metric-value font-mono">
                            {vehicle.speedKmH ?? 0} <span className="unit">km/h</span>
                          </div>
                        </div>
                      </div>

                      <div className="metric-box">
                        <Gauge size={20} className={vehicle.enginePercent < 40 ? 'text-danger' : 'text-accent'} />
                        <div>
                          <div className="metric-label">Saúde do Motor</div>
                          <div className="metric-value font-mono">
                            {vehicle.enginePercent ?? 100}%{' '}
                            <span className="unit">({vehicle.engineHealth ?? 1000}/1000)</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-sub-card">
                    <Car size={24} className="text-muted" />
                    <span>O jogador está a pé no momento.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════ ABA 2: INVENTÁRIO OX_INVENTORY (PILAR 2) ════ */}
          {activeTab === 'inventory' && (
            <div className="dossier-tab-content">
              {/* Barra de controle de inventário */}
              <div className="inv-toolbar">
                <div className="inv-capacity">
                  <div className="inv-capacity-text font-mono">
                    Peso:{' '}
                    <strong>
                      {((inventoryData?.weight || 0) / 1000).toFixed(2)} kg
                    </strong>{' '}
                    /{' '}
                    {((inventoryData?.maxWeight || 30000) / 1000).toFixed(2)} kg
                  </div>
                  <div className="inv-capacity-bar-track">
                    <div
                      className="inv-capacity-bar-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          ((inventoryData?.weight || 0) /
                            (inventoryData?.maxWeight || 30000)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="inv-search-box">
                  <MagnifyingGlass size={16} />
                  <input
                    type="text"
                    placeholder="Buscar item..."
                    value={invSearch}
                    onChange={(e) => setInvSearch(e.target.value)}
                  />
                </div>

                <button
                  className="btn-refresh-inv"
                  onClick={fetchInventory}
                  disabled={invLoading}
                  title="Atualizar inventário"
                >
                  <ArrowsClockwise
                    size={16}
                    className={invLoading ? 'spin-animation' : ''}
                  />
                  <span>Atualizar</span>
                </button>
              </div>

              {/* Grid de Itens */}
              {invLoading && !inventoryData ? (
                <div className="inv-loading-state">
                  <ArrowsClockwise size={32} className="spin-animation" />
                  <span>Carregando itens de ox_inventory...</span>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="inv-empty-state">
                  <Backpack size={40} className="text-muted" />
                  <span>Nenhum item encontrado no inventário.</span>
                </div>
              ) : (
                <div className="inv-items-grid">
                  {filteredItems.map((item, idx) => {
                    const durability = item.durability ?? 100;
                    return (
                      <div key={`${item.name}-${item.slot}-${idx}`} className="inv-item-card">
                        <div className="inv-item-header">
                          <span className="inv-slot-badge font-mono">#{item.slot}</span>
                          <span className="inv-count-badge font-mono">x{item.count}</span>
                        </div>

                        <div className="inv-item-icon-area">
                          <img
                            src={`/api/item-images/${encodeURIComponent(item.name)}.png`}
                            alt={item.label || item.name}
                            className="inv-item-image"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.parentElement?.querySelector('.inv-item-fallback');
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <div className="inv-item-fallback" style={{ display: 'none' }}>
                            <Backpack size={28} className="text-secondary" />
                          </div>
                        </div>

                        <div className="inv-item-info">
                          <div className="inv-item-label" title={item.label || item.name}>
                            {item.label || item.name}
                          </div>
                          <div className="inv-item-meta font-mono">
                            <span>{((item.weight * item.count) / 1000).toFixed(2)}kg</span>
                            {item.serial && (
                              <span className="inv-item-serial" title="Número de Série">
                                SN: {item.serial}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Barra de Durabilidade */}
                        {durability < 100 && (
                          <div
                            className="inv-durability-track"
                            title={`Durabilidade: ${durability.toFixed(0)}%`}
                          >
                            <div
                              className={`inv-durability-fill ${durability < 30 ? 'critical' : durability < 60 ? 'warning' : 'good'}`}
                              style={{ width: `${durability}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ════ ABA 3: MODERAÇÃO 1-CLIQUE (PILAR 3) ════ */}
          {activeTab === 'moderation' && (
            <div className="dossier-tab-content">
              {/* Seção 1: Ações Rápidas de Emergência */}
              <div className="mod-section">
                <h3>Ações Instantâneas</h3>
                <div className="mod-quick-actions-grid">
                  {/* Freeze / Unfreeze */}
                  <button
                    className={`btn-mod-action ${isFrozen ? 'unfreeze' : 'freeze'}`}
                    onClick={() => handleAdminAction('freeze', { toggle: !isFrozen })}
                    disabled={actionLoading}
                  >
                    <Snowflake size={20} weight="bold" />
                    <div>
                      <div className="btn-mod-title">
                        {isFrozen ? 'Descongelar Jogador' : 'Congelar Jogador'}
                      </div>
                      <div className="btn-mod-sub">
                        {isFrozen ? 'Permitir movimento' : 'Paralisar na posição'}
                      </div>
                    </div>
                  </button>

                  {/* Reviver */}
                  <button
                    className="btn-mod-action revive"
                    onClick={() => handleAdminAction('revive')}
                    disabled={actionLoading}
                  >
                    <FirstAid size={20} weight="bold" />
                    <div>
                      <div className="btn-mod-title">Reviver (God Revive)</div>
                      <div className="btn-mod-sub">Limpar morte, fome e sede</div>
                    </div>
                  </button>

                  {/* Curar */}
                  <button
                    className="btn-mod-action heal"
                    onClick={() => handleAdminAction('heal')}
                    disabled={actionLoading}
                  >
                    <Bandaids size={20} weight="bold" />
                    <div>
                      <div className="btn-mod-title">Curar (Heal)</div>
                      <div className="btn-mod-sub">200 HP + 100 Colete</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Seção 2: Teletransporte Remoto */}
              <div className="mod-section">
                <h3>Teletransporte Remoto</h3>
                <div className="teleport-chips">
                  {PREDEFINED_LOCATIONS.map((loc) => (
                    <button
                      key={loc.label}
                      className="teleport-chip"
                      onClick={() =>
                        handleAdminAction('teleport', {
                          coords: { x: loc.x, y: loc.y, z: loc.z },
                        })
                      }
                      disabled={actionLoading}
                    >
                      <MapPin size={14} weight="bold" />
                      <span>{loc.label}</span>
                    </button>
                  ))}
                </div>

                <div className="custom-coords-form">
                  <input
                    type="number"
                    placeholder="X"
                    value={customCoords.x}
                    onChange={(e) =>
                      setCustomCoords({ ...customCoords, x: e.target.value })
                    }
                  />
                  <input
                    type="number"
                    placeholder="Y"
                    value={customCoords.y}
                    onChange={(e) =>
                      setCustomCoords({ ...customCoords, y: e.target.value })
                    }
                  />
                  <input
                    type="number"
                    placeholder="Z"
                    value={customCoords.z}
                    onChange={(e) =>
                      setCustomCoords({ ...customCoords, z: e.target.value })
                    }
                  />
                  <button
                    className="btn-custom-teleport"
                    onClick={() => {
                      const x = parseFloat(customCoords.x);
                      const y = parseFloat(customCoords.y);
                      const z = parseFloat(customCoords.z);
                      if (isNaN(x) || isNaN(y) || isNaN(z)) {
                        setStatusMessage({
                          type: 'error',
                          text: 'Digite coordenadas X, Y e Z válidas.',
                        });
                        return;
                      }
                      handleAdminAction('teleport', { coords: { x, y, z } });
                    }}
                    disabled={actionLoading}
                  >
                    Teleportar
                  </button>
                </div>
              </div>

              {/* Seção 3: Enviar Aviso na Tela (Warn / DM) */}
              <div className="mod-section">
                <h3>Aviso na Tela (Warn / DM)</h3>
                <div className="quick-presets">
                  {QUICK_WARN_PRESETS.map((preset, idx) => (
                    <button
                      key={idx}
                      className="preset-btn"
                      onClick={() => setWarnMessage(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div className="warn-input-group">
                  <textarea
                    rows={2}
                    placeholder="Digite a mensagem de advertência que aparecerá em destaque na tela do jogador..."
                    value={warnMessage}
                    onChange={(e) => setWarnMessage(e.target.value)}
                  />
                  <button
                    className="btn-send-warn"
                    onClick={() => handleAdminAction('warn', { message: warnMessage })}
                    disabled={actionLoading || !warnMessage.trim()}
                  >
                    <PaperPlaneTilt size={16} weight="bold" />
                    <span>Disparar Aviso</span>
                  </button>
                </div>
              </div>

              {/* Seção 4: Expulsão (Kick) */}
              <div className="mod-section danger-zone">
                <h3>Expulsar do Servidor (Kick)</h3>
                <div className="quick-presets">
                  {QUICK_KICK_REASONS.map((reason, idx) => (
                    <button
                      key={idx}
                      className="preset-btn danger"
                      onClick={() => setKickReason(reason)}
                    >
                      {reason}
                    </button>
                  ))}
                </div>

                <div className="kick-input-group">
                  <input
                    type="text"
                    placeholder="Motivo formal da expulsão..."
                    value={kickReason}
                    onChange={(e) => setKickReason(e.target.value)}
                  />
                  <button
                    className="btn-kick"
                    onClick={() => {
                      if (!confirm(`Tem certeza que deseja expulsar ${player.characterName || player.name} (#${player.id})?`)) {
                        return;
                      }
                      handleAdminAction('kick', { reason: kickReason });
                    }}
                    disabled={actionLoading}
                  >
                    <Prohibit size={16} weight="bold" />
                    <span>Expulsar</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Motion.div>
    </div>
  );
}
