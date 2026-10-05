/**
 * PlayerList.jsx — Sidebar showing all connected players with RP telemetry.
 *
 * Pilares atendidos:
 * - Pilar 2: Exibição de Nome RP, Emprego/Cargo, Indicador de Veículo (Placa e Velocidade)
 * - Abertura do Dossiê Completo e Inventário (ox_inventory)
 * - Botão de início/término de stream
 *
 * @module PlayerList
 */

import { useState } from 'react';
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
} from '@phosphor-icons/react';

export default function PlayerList({
  players,
  selectedId,
  streamingIds = [],
  onSelect,
  onStartStream,
  onStopStream,
  onOpenDossier,
}) {
  const [search, setSearch] = useState('');

  /** Filter players by search query (name, character name, citizenid, id) */
  const filtered = players.filter((p) => {
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
      {/* Sidebar Header */}
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <h2>Jogadores ({players.length})</h2>
          <span className="sidebar-count-badge font-mono">
            {streamingIds.length > 0 && `${streamingIds.length} telando`}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Buscar por nome, ID, emprego, placa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Player List */}
      <div className="player-list">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
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
            filtered.map((player) => {
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
                        {player.characterName || player.name}
                      </span>
                      {isFrozen && (
                        <span className="frozen-badge" title="Jogador Congelado">
                          <Snowflake size={12} weight="bold" />
                        </span>
                      )}
                    </div>

                    <div className="player-sub-meta">
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
    </aside>
  );
}
