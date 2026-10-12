/**
 * SpotlightSearch.jsx — Universal Command & Player Spotlight (Cmd+K / Ctrl+K)
 *
 * Busca instantânea omnibox para a Staff:
 * - Localização imediata de jogadores por ID, Nome de RP, Steam, CitizenID ou Placa
 * - Atalhos para comandos globais (/clima, /anuncio, /bans, /auditoria)
 * - Navegação via teclado (Arrow Up/Down, Enter, Esc)
 *
 * Em total conformidade com DESIGN.md (paleta #090d16, #10b981, sem tons roxos).
 *
 * @module SpotlightSearch
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  MagnifyingGlass,
  User,
  Broadcast,
  IdentificationCard,
  MapPin,
  Car,
  CloudSun,
  MegaphoneSimple,
  Prohibit,
  Scroll,
  X,
  ArrowBendDownLeft,
  ArrowsVertical,
} from '@phosphor-icons/react';

export default function SpotlightSearch({
  players = [],
  streamingIds = [],
  onOpenDossier,
  onStartStream,
  onFocusPlayer,
  onOpenServerControl,
  onOpenAuditLogs,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fechar com ESC
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Ações de Comando Rápido (Prefixados por / ou palavras-chave)
  const systemCommands = useMemo(() => [
    {
      id: 'cmd-broadcast',
      type: 'command',
      title: 'Comunicado Global da Cidade',
      subtitle: '/broadcast ou /anuncio — Transmitir alerta sonoro e notificação para todos',
      icon: MegaphoneSimple,
      action: () => {
        onOpenServerControl('broadcast');
        onClose();
      },
      keywords: ['anuncio', 'broadcast', 'mensagem', 'aviso', 'global', '/anuncio', '/broadcast'],
    },
    {
      id: 'cmd-weather',
      type: 'command',
      title: 'Controle de Clima & Horário',
      subtitle: '/clima ou /tempo — Sincronizar atmosfera da cidade e relógio oficial',
      icon: CloudSun,
      action: () => {
        onOpenServerControl('world');
        onClose();
      },
      keywords: ['clima', 'tempo', 'hora', 'horario', 'sol', 'chuva', 'world', '/clima', '/tempo'],
    },
    {
      id: 'cmd-bans',
      type: 'command',
      title: 'Registro Geral de Banimentos',
      subtitle: '/bans — Consultar e revogar banimentos ativos da base de dados',
      icon: Prohibit,
      action: () => {
        onOpenServerControl('bans');
        onClose();
      },
      keywords: ['bans', 'ban', 'desban', 'unban', 'punicao', '/bans'],
    },
    {
      id: 'cmd-audit',
      type: 'command',
      title: 'Histórico de Auditoria Staff',
      subtitle: '/auditoria — Consultar logs de vigilância e ações executadas',
      icon: Scroll,
      action: () => {
        onOpenAuditLogs();
        onClose();
      },
      keywords: ['auditoria', 'logs', 'audit', 'historico', '/logs', '/audit'],
    },
  ], [onOpenServerControl, onOpenAuditLogs, onClose]);

  // Filtragem Dinâmica de Resultados
  const filteredResults = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    const results = [];

    // 1. Filtrar Comandos do Sistema
    if (cleanQuery) {
      const matchedCmds = systemCommands.filter((cmd) => {
        if (cleanQuery.startsWith('/')) {
          return cmd.keywords.some((k) => k.startsWith(cleanQuery));
        }
        return (
          cmd.title.toLowerCase().includes(cleanQuery) ||
          cmd.keywords.some((k) => k.includes(cleanQuery))
        );
      });
      results.push(...matchedCmds);
    }

    // 2. Filtrar Jogadores Online
    const matchedPlayers = players.filter((p) => {
      if (!cleanQuery) return true;
      const pid = String(p.id);
      const name = (p.name || '').toLowerCase();
      const charName = (p.characterName || '').toLowerCase();
      const steamName = (p.steamName || '').toLowerCase();
      const citizenId = (p.dossier?.citizenid || '').toLowerCase();
      const job = (p.dossier?.job?.label || p.dossier?.job?.name || '').toLowerCase();
      const plate = (p.vehicle?.plate || '').toLowerCase();

      return (
        pid === cleanQuery ||
        `#${pid}` === cleanQuery ||
        name.includes(cleanQuery) ||
        charName.includes(cleanQuery) ||
        steamName.includes(cleanQuery) ||
        citizenId.includes(cleanQuery) ||
        job.includes(cleanQuery) ||
        plate.includes(cleanQuery)
      );
    }).map((p) => ({
      id: `player-${p.id}`,
      type: 'player',
      player: p,
      title: p.characterName || p.name,
      subtitle: `ID #${p.id} • ${p.dossier?.job?.label || 'Desempregado'} • ${p.vehicle?.plate ? `Placa: ${p.vehicle.plate}` : 'A pé'}`,
    }));

    results.push(...matchedPlayers);
    return results;
  }, [query, players, systemCommands]);

  // Reseta seleção ao digitar
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Executar item selecionado
  const handleSelect = (item) => {
    if (!item) return;
    if (item.type === 'command') {
      item.action();
    } else if (item.type === 'player') {
      onOpenDossier(item.player.id);
      onClose();
    }
  };

  // Navegação por teclado
  const handleKeyDown = (e) => {
    if (filteredResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredResults.length) % filteredResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(filteredResults[selectedIndex]);
    }
  };

  return (
    <div className="dossier-backdrop" onClick={onClose} style={{ alignItems: 'flex-start', paddingTop: '10vh' }}>
      <Motion.div
        className="spotlight-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        style={{
          width: '100%',
          maxWidth: '640px',
          background: 'var(--color-surface, #0e1524)',
          border: '1px solid var(--color-border-strong, rgba(148, 163, 184, 0.28))',
          borderRadius: '12px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.65)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Input Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 18px',
            borderBottom: '1px solid var(--color-border, rgba(148, 163, 184, 0.15))',
            background: 'var(--color-surface-raised, #141e33)',
          }}
        >
          <MagnifyingGlass size={20} weight="bold" color="var(--color-primary, #10b981)" />
          <input
            ref={inputRef}
            type="text"
            className="spotlight-input"
            placeholder="Buscar por ID (#12), nome, placa, /clima, /anuncio..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--color-text, #f8fafc)',
              fontSize: '1rem',
              fontWeight: 500,
            }}
          />
          {query ? (
            <button
              className="btn-icon"
              onClick={() => setQuery('')}
              style={{ width: '24px', height: '24px', padding: 0 }}
            >
              <X size={14} />
            </button>
          ) : (
            <span
              style={{
                fontSize: '0.68rem',
                color: '#64748b',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(148, 163, 184, 0.15)',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600,
              }}
            >
              ESC para sair
            </span>
          )}
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          style={{
            maxHeight: '380px',
            overflowY: 'auto',
            padding: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {filteredResults.length === 0 ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: '#64748b',
                fontSize: '0.85rem',
              }}
            >
              Nenhum jogador ou comando encontrado para "{query}"
            </div>
          ) : (
            filteredResults.map((item, index) => {
              const isSelected = index === selectedIndex;

              if (item.type === 'command') {
                const IconComp = item.icon;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                      border: `1px solid ${isSelected ? 'rgba(16, 185, 129, 0.3)' : 'transparent'}`,
                      transition: 'all 0.1s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#10b981',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <IconComp size={16} weight="bold" />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                          {item.title}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <ArrowBendDownLeft size={14} color="#10b981" weight="bold" />
                    )}
                  </div>
                );
              }

              // Item Player
              const p = item.player;
              const isStreaming = streamingIds.includes(p.id);

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                    border: `1px solid ${isSelected ? 'rgba(16, 185, 129, 0.3)' : 'transparent'}`,
                    transition: 'all 0.1s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        background: isStreaming ? 'rgba(239, 68, 68, 0.15)' : 'rgba(148, 163, 184, 0.1)',
                        color: isStreaming ? '#ef4444' : '#94a3b8',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        fontFamily: 'monospace',
                      }}
                    >
                      {p.id}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                          {p.characterName || p.name}
                        </span>
                        {p.vehicle && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                              padding: '1px 5px',
                              borderRadius: '3px',
                            }}
                          >
                            {p.vehicle.plate || 'EM VEÍCULO'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  {/* Ações Rápidas do Item */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="btn-icon"
                      title="Focar no Mapa"
                      onClick={() => {
                        onFocusPlayer(p.id);
                        onClose();
                      }}
                      style={{ width: '28px', height: '28px', padding: 0 }}
                    >
                      <MapPin size={14} />
                    </button>

                    <button
                      className="btn-icon"
                      title={isStreaming ? 'Já em telagem' : 'Iniciar Telagem'}
                      onClick={() => {
                        onStartStream(p.id);
                        onClose();
                      }}
                      style={{
                        width: '28px',
                        height: '28px',
                        padding: 0,
                        color: isStreaming ? '#ef4444' : 'inherit',
                      }}
                    >
                      <Broadcast size={14} weight={isStreaming ? 'fill' : 'regular'} />
                    </button>

                    <button
                      className="inv-action-btn"
                      onClick={() => {
                        onOpenDossier(p.id);
                        onClose();
                      }}
                      style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                    >
                      <span>Dossiê</span>
                      <ArrowBendDownLeft size={11} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Shortcut Hints */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'var(--color-canvas, #090d16)',
            borderTop: '1px solid var(--color-border, rgba(148, 163, 184, 0.12))',
            fontSize: '0.7rem',
            color: '#64748b',
          }}
        >
          <div style={{ display: 'flex', gap: '12px' }}>
            <span><strong style={{ color: '#94a3b8' }}>↑↓</strong> Navegar</span>
            <span><strong style={{ color: '#94a3b8' }}>↵</strong> Selecionar</span>
            <span><strong style={{ color: '#94a3b8' }}>ESC</strong> Fechar</span>
          </div>
          <span>Vanguard Spotlight v1.0</span>
        </div>
      </Motion.div>
    </div>
  );
}
