/**
 * PlayerDossierModal.jsx — Central Administrativa e Dossiê Completo do Cidadão
 *
 * Pilares Integrados:
 * 1. Telagem Concorrente / PiP: Alternar e monitorar sem bloqueio da tela.
 * 2. Dossiê RP & Ocupação: Identidade, Empregos (SetJob) e Facções (SetGang) com hierarquias/grades (online & offline).
 * 3. Gestão Financeira Completa: Carteira, Banco e Gemas VIP (dp_sistema_gemas) com presets rápidos e operações atômicas.
 * 4. Frota de Veículos & Garagem do Cidadão: Visualização de todos os veículos registrados (player_vehicles),
 *    status em tempo real (Guardado, Na Rua, Apreendido, Destruído), inspeção de Porta-Malas e Porta-Luvas (ox_inventory),
 *    Spawn ao lado, Guardar na Garagem (DV), Reparar e Apreender/Liberar.
 * 5. Moderação & Prisão Administrativa (pickle_prisons): Relógio de contagem regressiva em tempo real,
 *    Alvará de Soltura imediato (Unjail), redução rápida de pena (-5m, -10m, -15m, -30m, -60m),
 *    e envio para a cadeia com presets e motivo formal (online e offline).
 * 6. Inventário ox_inventory: Visualização de todos os itens com imagens oficiais, durabilidade, injeção com
 *    autocompletion a partir do catálogo do servidor, confisco de armas e wipe.
 *
 * @module PlayerDossierModal
 */

import { useState, useEffect, useRef, useMemo } from 'react';
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
  EyeSlash,
  MagnifyingGlass,
  CheckCircle,
  WarningCircle,
  Sword,
  Trash,
  Plus,
  Minus,
  SpeakerHigh,
  SpeakerSlash,
  ChatText,
  ChatSlash,
  Lock,
  LockKeyOpen,
  UserSwitch,
  Clock,
  Wrench,
  Package,
  GasPump,
  PencilSimple,
  Sparkle,
  FloppyDiskBack,
  FolderOpen,
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
  'Ajuste de inventário / Relogar para sincronização',
];

const QUICK_JAIL_PRESETS = [
  { label: '10 Min', minutes: 10 },
  { label: '20 Min', minutes: 20 },
  { label: '30 Min', minutes: 30 },
  { label: '60 Min', minutes: 60 },
  { label: '120 Min', minutes: 120 },
];

// Utilitários para extração segura de Grade / Cargo (evita React error #31 com objetos {name, level})
function formatGradeLabel(group) {
  if (!group) return 'Grau 0';
  if (typeof group.gradeName === 'string' && group.gradeName.trim()) {
    return group.gradeName;
  }
  if (typeof group.grade === 'object' && group.grade !== null) {
    if (group.grade.name) return group.grade.name;
    if (group.grade.level !== undefined) return `Grau ${group.grade.level}`;
  }
  if (typeof group.grade === 'number' || (typeof group.grade === 'string' && group.grade.trim())) {
    return `Grau ${group.grade}`;
  }
  return 'Iniciante';
}

function extractGradeLevel(group) {
  if (!group) return 0;
  if (typeof group.gradeLevel === 'number') return group.gradeLevel;
  if (typeof group.grade === 'object' && group.grade !== null) {
    return Number(group.grade.level ?? group.grade.grade ?? 0) || 0;
  }
  if (typeof group.grade === 'number') return group.grade;
  if (typeof group.grade === 'string') return parseInt(group.grade) || 0;
  return 0;
}

function normalizeGroup(rawGroup, fallbackName, fallbackLabel, fallbackGradeName) {
  if (!rawGroup || typeof rawGroup !== 'object') {
    return {
      name: fallbackName,
      label: fallbackLabel,
      gradeName: fallbackGradeName,
      gradeLevel: 0,
      grade: 0,
      onduty: false,
    };
  }
  const gradeName = (typeof rawGroup.grade === 'object' && rawGroup.grade?.name)
    ? rawGroup.grade.name
    : (typeof rawGroup.gradeName === 'string' && rawGroup.gradeName.trim() ? rawGroup.gradeName : fallbackGradeName);

  const gradeLevel = (typeof rawGroup.grade === 'object' && rawGroup.grade?.level !== undefined)
    ? Number(rawGroup.grade.level)
    : (Number(rawGroup.grade) || (Number(rawGroup.gradeLevel) || 0));

  return {
    name: rawGroup.name || fallbackName,
    label: rawGroup.label || fallbackLabel,
    gradeName,
    gradeLevel,
    grade: gradeLevel,
    onduty: Boolean(rawGroup.onduty),
  };
}

export default function PlayerDossierModal({
  player: initialPlayer,
  onClose,
  onStartStream,
  onStopStream,
  isStreaming,
}) {
  const [activePlayer, setActivePlayer] = useState(initialPlayer);
  const [activeTab, setActiveTab] = useState('dossier'); // 'dossier' | 'inventory' | 'vehicle' | 'moderation'
  const [dossierData, setDossierData] = useState(initialPlayer?.dossier || null);
  const [dossierLoading, setDossierLoading] = useState(!initialPlayer?.dossier);
  const [inventoryData, setInventoryData] = useState(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);

  // Multicharacter State
  const [accountCharacters, setAccountCharacters] = useState([]);
  const [loadingCharacters, setLoadingCharacters] = useState(false);

  // Mute & Freeze State
  const [isVoiceMuted, setIsVoiceMuted] = useState(Boolean(initialPlayer?.isVoiceMuted || initialPlayer?.dossier?.isVoiceMuted));
  const [isChatMuted, setIsChatMuted] = useState(Boolean(initialPlayer?.isChatMuted || initialPlayer?.dossier?.isChatMuted));
  const [isFrozen, setIsFrozen] = useState(Boolean(initialPlayer?.isFrozen));

  // Prisão (pickle_prisons) State
  const [prisonerStatus, setPrisonerStatus] = useState(null);
  const [loadingPrisoner, setLoadingPrisoner] = useState(false);
  const [prisonCountdown, setPrisonCountdown] = useState(0); // em segundos
  const [jailTime, setJailTime] = useState(15);
  const [jailReason, setJailReason] = useState('');
  const [reduceMinutes, setReduceMinutes] = useState(5);
  const [setExactJailMinutes, setSetExactJailMinutes] = useState(10);

  // Ocupação (SetJob e SetGang) State
  const [serverJobs, setServerJobs] = useState({});
  const [serverGangs, setServerGangs] = useState({});
  const [loadingJobsGangs, setLoadingJobsGangs] = useState(false);
  const [editingJob, setEditingJob] = useState(false);
  const [selectedJob, setSelectedJob] = useState('');
  const [selectedJobGrade, setSelectedJobGrade] = useState(0);
  const [editingGang, setEditingGang] = useState(false);
  const [selectedGang, setSelectedGang] = useState('');
  const [selectedGangGrade, setSelectedGangGrade] = useState(0);

  // Frota de Veículos do Cidadão (player_vehicles)
  const [ownedVehicles, setOwnedVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [inspectingVehicle, setInspectingVehicle] = useState(null); // { plate, displayName, type }
  const [trunkType, setTrunkType] = useState('trunk'); // 'trunk' | 'glovebox'
  const [trunkInventory, setTrunkInventory] = useState(null);
  const [trunkLoading, setTrunkLoading] = useState(false);
  const [customPlate, setCustomPlate] = useState('');

  // Itens & Catálogo ox_inventory
  const [itemsCatalog, setItemsCatalog] = useState([]);
  const [giveItemOpen, setGiveItemOpen] = useState(false);
  const [giveItemName, setGiveItemName] = useState('');
  const [giveItemCount, setGiveItemCount] = useState(1);
  const [catalogSuggestions, setCatalogSuggestions] = useState([]);

  // Seletor & Catálogo Geral de Itens (Item Browser)
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(120);

  // Reinicia contagem de exibição ao trocar categoria ou busca
  useEffect(() => {
    setCatalogVisibleCount(120);
  }, [catalogSearch, catalogCategory]);

  // Moderação & Ações Rápidas
  const [warnMessage, setWarnMessage] = useState('');
  const [kickReason, setKickReason] = useState('');
  const [customCoords, setCustomCoords] = useState({ x: '', y: '', z: '' });
  const [banDuration, setBanDuration] = useState('1440');
  const [isPermanentBan, setIsPermanentBan] = useState(false);
  const [banReason, setBanReason] = useState('');

  // Gestão Financeira
  const [moneyAccount, setMoneyAccount] = useState('bank');
  const [moneyOp, setMoneyOp] = useState('add');
  const [moneyAmount, setMoneyAmount] = useState('');

  const isOffline = Boolean(activePlayer?.isOffline || (!activePlayer?.onlineId && !activePlayer?.id));

  // Cálculo preciso de peso de inventário (em gramas)
  const calculateInventoryWeight = (itemsList, catalog = itemsCatalog) => {
    if (!Array.isArray(itemsList)) return 0;
    const catalogMap = new Map((catalog || []).map((it) => [it.name, it]));
    return itemsList.reduce((acc, item) => {
      let w = Number(item.weight);
      if (!w || isNaN(w) || w <= 0) {
        const catItem = catalogMap.get(item.name);
        w = Number(catItem?.weight) || 0;
      }
      const count = Number(item.count) || 1;
      return acc + (w * count);
    }, 0);
  };

  // Sincroniza quando a prop do jogador mudar externamente
  useEffect(() => {
    setActivePlayer(initialPlayer);
    if (initialPlayer?.dossier) setDossierData(initialPlayer.dossier);
    setIsVoiceMuted(Boolean(initialPlayer?.isVoiceMuted || initialPlayer?.dossier?.isVoiceMuted));
    setIsChatMuted(Boolean(initialPlayer?.isChatMuted || initialPlayer?.dossier?.isChatMuted));
    setIsFrozen(Boolean(initialPlayer?.isFrozen));
  }, [initialPlayer?.id, initialPlayer?.citizenid, initialPlayer?.isFrozen]);

  // Carrega catálogo de itens ox_inventory
  useEffect(() => {
    fetch('/api/inventory/catalog')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setItemsCatalog(data);
      })
      .catch((err) => console.warn('[PlayerDossier] Erro ao carregar catálogo de itens:', err));
  }, []);

  // Filtro de autocomplete do catálogo de itens ao digitar (com normalização de acentos)
  useEffect(() => {
    if (!giveItemName.trim()) {
      setCatalogSuggestions([]);
      return;
    }
    const normalize = (txt) => (txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const q = normalize(giveItemName);
    const matches = itemsCatalog
      .filter((it) => {
        const n = normalize(it.name);
        const l = normalize(it.label);
        return n.includes(q) || l.includes(q);
      })
      .slice(0, 15);
    setCatalogSuggestions(matches);
  }, [giveItemName, itemsCatalog]);

  // Consulta status de prisão (pickle_prisons)
  const fetchPrisonerStatus = () => {
    const socket = getSocket();
    if (!socket) return;
    const citizenid = activePlayer?.citizenid || activePlayer?.dossier?.citizenid || dossierData?.citizenid;
    const targetPlayerId = activePlayer?.onlineId || (isOffline ? 0 : activePlayer?.id) || 0;

    setLoadingPrisoner(true);
    socket.emit('get_prisoner_status', { playerId: targetPlayerId, citizenid }, (res) => {
      setLoadingPrisoner(false);
      if (res && res.success) {
        setPrisonerStatus({
          inPrison: Boolean(res.inPrison),
          remainingMinutes: Number(res.remainingMinutes) || 0,
          remainingSeconds: Number(res.remainingSeconds) || 0,
          prisonName: res.prisonName || 'default',
          sentenceDate: res.sentenceDate || null,
        });
        setPrisonCountdown(Number(res.remainingSeconds) || (Number(res.remainingMinutes) * 60) || 0);
      }
    });
  };

  // Cronômetro dinâmico em tempo real de contagem regressiva da pena
  useEffect(() => {
    if (!prisonerStatus?.inPrison || prisonCountdown <= 0) return;
    const timer = setInterval(() => {
      setPrisonCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          fetchPrisonerStatus();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [prisonerStatus?.inPrison, prisonCountdown]);

  // Consulta todos os personagens da conta (Multicharacter)
  const fetchAccountCharacters = () => {
    const socket = getSocket();
    if (!socket) return;
    const targetPlayerId = activePlayer?.onlineId || (isOffline ? 0 : activePlayer?.id) || 0;
    const license = activePlayer?.license || activePlayer?.dossier?.license;
    const citizenid = activePlayer?.citizenid || activePlayer?.dossier?.citizenid || dossierData?.citizenid;

    setLoadingCharacters(true);
    socket.emit('get_player_characters', { license, citizenid, playerId: targetPlayerId }, (res) => {
      setLoadingCharacters(false);
      if (res && res.success && Array.isArray(res.characters)) {
        setAccountCharacters(res.characters);
      }
    });
  };

  // Consulta catálogo de empregos e facções do servidor
  const fetchJobsAndGangs = () => {
    const socket = getSocket();
    if (!socket) return;
    setLoadingJobsGangs(true);
    socket.emit('get_jobs_and_gangs', {}, (res) => {
      setLoadingJobsGangs(false);
      if (res && res.success) {
        if (res.jobs) setServerJobs(res.jobs);
        if (res.gangs) setServerGangs(res.gangs);
      }
    });
  };

  // Consulta frota de veículos registrados do cidadão (player_vehicles)
  const fetchPlayerVehicles = () => {
    const socket = getSocket();
    if (!socket) return;
    const citizenid = activePlayer?.citizenid || activePlayer?.dossier?.citizenid || dossierData?.citizenid;
    if (!citizenid) return;

    setLoadingVehicles(true);
    socket.emit('get_player_vehicles', { citizenid }, (res) => {
      setLoadingVehicles(false);
      if (res && res.success && Array.isArray(res.vehicles)) {
        setOwnedVehicles(res.vehicles);
      } else {
        setOwnedVehicles([]);
      }
    });
  };

  // Carrega Multichar, Prisão, Empregos e Veículos na abertura
  useEffect(() => {
    fetchAccountCharacters();
    fetchPrisonerStatus();
    fetchJobsAndGangs();
    fetchPlayerVehicles();
  }, [activePlayer?.id, activePlayer?.citizenid]);

  // Atualiza frota ao clicar na aba de veículos
  useEffect(() => {
    if (activeTab === 'vehicle') {
      fetchPlayerVehicles();
    }
  }, [activeTab]);

  // Alterna o foco do dossiê para outro personagem da mesma conta
  const handleSelectCharacter = (char) => {
    setActivePlayer(char);
    const slotNumber = Number((char.cid !== undefined && char.cid !== null) ? char.cid : (char.charinfo?.cid || 1));
    const normalizedDossier = char.dossier ? {
      ...char.dossier,
      job: normalizeGroup(char.dossier.job || char.job, 'unemployed', 'Civil', 'Iniciante'),
      gang: normalizeGroup(char.dossier.gang || char.gang, 'none', 'Nenhuma', 'Membro'),
    } : {
      citizenid: char.citizenid,
      cid: slotNumber,
      license: char.license,
      firstname: char.charinfo?.firstname || '',
      lastname: char.charinfo?.lastname || '',
      birthdate: char.charinfo?.birthdate || '',
      gender: char.charinfo?.gender === 0 ? 'M' : (char.charinfo?.gender === 1 ? 'F' : 'Outro'),
      phone: char.phoneNumber || char.phone || 'Sem telefone',
      job: normalizeGroup(char.job, 'unemployed', 'Civil', 'Iniciante'),
      gang: normalizeGroup(char.gang, 'none', 'Nenhuma', 'Membro'),
      money: char.money || { cash: 0, bank: 0, crypto: 0, gems: 0 },
      isVoiceMuted: Boolean(char.isVoiceMuted),
      isChatMuted: Boolean(char.isChatMuted),
    };
    setDossierData(normalizedDossier);
    if (char.inventory) {
      const raw = char.inventory;
      const itemsList = Array.isArray(raw) ? raw : (typeof raw === 'object' && raw !== null ? Object.values(raw) : []);
      const items = itemsList.map((it, idx) => ({
        ...it,
        slot: it.slot ?? (idx + 1),
        label: it.label || it.name,
        count: Number(it.count) || 1,
        weight: Number(it.weight) || 0,
      }));
      const calcWeight = calculateInventoryWeight(items, itemsCatalog);
      setInventoryData({
        weight: calcWeight,
        maxWeight: 30000,
        slots: 50,
        items,
      });
    } else {
      setInventoryData(null);
    }
    setIsFrozen(Boolean(char.isFrozen));
    setIsVoiceMuted(Boolean(char.isVoiceMuted));
    setIsChatMuted(Boolean(char.isChatMuted));
    setInspectingVehicle(null);
    setTrunkInventory(null);
  };

  // Busca dados do Dossiê via QBX Core sob demanda
  const fetchDossier = () => {
    if (isOffline) {
      if (activePlayer?.dossier) {
        setDossierData({
          ...activePlayer.dossier,
          job: normalizeGroup(activePlayer.dossier.job, 'unemployed', 'Civil', 'Iniciante'),
          gang: normalizeGroup(activePlayer.dossier.gang, 'none', 'Nenhuma', 'Membro'),
        });
      } else {
        setDossierData(activePlayer);
      }
      setDossierLoading(false);
      return;
    }

    if (!activePlayer?.id) return;
    if (!activePlayer?.dossier && !dossierData) {
      setDossierLoading(true);
    }
    const socket = getSocket();
    if (!socket) {
      setDossierLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setDossierLoading(false);
    }, 2500);

    socket.emit('get_player_dossier', { playerId: activePlayer.id }, (response) => {
      clearTimeout(timer);
      setDossierLoading(false);
      if (response && response.success && response.dossier) {
        setDossierData({
          ...response.dossier,
          job: normalizeGroup(response.dossier.job, 'unemployed', 'Civil', 'Iniciante'),
          gang: normalizeGroup(response.dossier.gang, 'none', 'Nenhuma', 'Membro'),
        });
        if (response.dossier?.isVoiceMuted !== undefined) setIsVoiceMuted(Boolean(response.dossier.isVoiceMuted));
        if (response.dossier?.isChatMuted !== undefined) setIsChatMuted(Boolean(response.dossier.isChatMuted));
      } else if (!activePlayer?.dossier) {
        setStatusMessage({
          type: 'error',
          text: response?.error || 'Não foi possível consultar dossiê no QBX Core.',
        });
      }
    });
  };

  useEffect(() => {
    if (isOffline) {
      const slotNumber = Number((activePlayer?.cid !== undefined && activePlayer?.cid !== null) ? activePlayer.cid : (activePlayer?.charinfo?.cid || 1));
      const sourceDossier = activePlayer?.dossier || {};
      setDossierData({
        citizenid: activePlayer?.citizenid || sourceDossier.citizenid,
        cid: slotNumber,
        license: activePlayer?.license || sourceDossier.license,
        firstname: activePlayer?.charinfo?.firstname || sourceDossier.firstname || '',
        lastname: activePlayer?.charinfo?.lastname || sourceDossier.lastname || '',
        birthdate: activePlayer?.charinfo?.birthdate || sourceDossier.birthdate || '',
        gender: activePlayer?.charinfo?.gender === 0 ? 'M' : (activePlayer?.charinfo?.gender === 1 ? 'F' : 'Outro'),
        phone: activePlayer?.phoneNumber || activePlayer?.phone || sourceDossier.phone || 'Sem telefone',
        job: normalizeGroup(activePlayer?.job || sourceDossier.job, 'unemployed', 'Civil', 'Iniciante'),
        gang: normalizeGroup(activePlayer?.gang || sourceDossier.gang, 'none', 'Nenhuma', 'Membro'),
        money: activePlayer?.money || sourceDossier.money || { cash: 0, bank: 0, crypto: 0, gems: 0 },
        isVoiceMuted: Boolean(activePlayer?.isVoiceMuted || sourceDossier.isVoiceMuted),
        isChatMuted: Boolean(activePlayer?.isChatMuted || sourceDossier.isChatMuted),
      });
      setDossierLoading(false);
    } else if (activePlayer?.dossier) {
      setDossierData({
        ...activePlayer.dossier,
        job: normalizeGroup(activePlayer.dossier.job, 'unemployed', 'Civil', 'Iniciante'),
        gang: normalizeGroup(activePlayer.dossier.gang, 'none', 'Nenhuma', 'Membro'),
      });
      setDossierLoading(false);
    } else if (activePlayer?.id && !dossierData) {
      fetchDossier();
    }
  }, [activePlayer?.id, activePlayer?.citizenid, isOffline]);

  // Busca dados do ox_inventory quando a aba de inventário é acessada
  const fetchInventory = () => {
    const citizenid = activePlayer?.citizenid || activePlayer?.dossier?.citizenid || dossierData?.citizenid;
    const targetPlayerId = activePlayer?.onlineId || (isOffline ? 0 : activePlayer?.id) || 0;

    if (isOffline && activePlayer?.inventory) {
      const raw = activePlayer.inventory;
      const itemsList = Array.isArray(raw) ? raw : (typeof raw === 'object' && raw !== null ? Object.values(raw) : []);
      const items = itemsList.map((it, idx) => ({
        ...it,
        slot: it.slot ?? (idx + 1),
        label: it.label || it.name,
        count: Number(it.count) || 1,
        weight: Number(it.weight) || 0,
      }));
      const calcWeight = calculateInventoryWeight(items, itemsCatalog);
      setInventoryData({
        weight: calcWeight,
        maxWeight: 30000,
        slots: 50,
        items,
      });
    }

    setInvLoading(true);
    const socket = getSocket();
    if (!socket) {
      setInvLoading(false);
      return;
    }

    socket.emit('get_player_inventory', { playerId: targetPlayerId, citizenid }, (response) => {
      setInvLoading(false);
      if (response && response.success && response.inventory) {
        let inv = response.inventory;
        if ((!inv.weight || inv.weight === 0) && inv.items?.length > 0) {
          inv.weight = calculateInventoryWeight(inv.items, itemsCatalog);
        }
        setInventoryData(inv);
      } else if (!isOffline) {
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
  }, [activeTab, activePlayer?.id, activePlayer?.citizenid, isOffline]);

  // Inspeciona baú ou porta-luvas de um veículo (online ou offline)
  const handleInspectVehicleTrunk = (plate, type = 'trunk', displayName = 'Veículo') => {
    const cleanPlate = String(plate || '').trim().toUpperCase();
    if (!cleanPlate) return;

    setTrunkLoading(true);
    setInspectingVehicle({ plate: cleanPlate, displayName, type });
    setTrunkType(type);

    const socket = getSocket();
    if (!socket) {
      setTrunkLoading(false);
      setStatusMessage({ type: 'error', text: 'Sem conexão com o servidor.' });
      return;
    }

    const timer = setTimeout(() => {
      setTrunkLoading(false);
      setStatusMessage({ type: 'error', text: 'Tempo limite ao consultar compartimento veicular.' });
    }, 4000);

    socket.emit('get_vehicle_inventory', { plate: cleanPlate, type }, (res) => {
      clearTimeout(timer);
      setTrunkLoading(false);
      if (res && res.success) {
        setTrunkInventory(res.inventory || { items: [] });
      } else {
        setTrunkInventory({ items: [] });
        setStatusMessage({
          type: 'error',
          text: res?.error || `Compartimento ${type === 'glovebox' ? 'porta-luvas' : 'porta-malas'} vazio ou inexistente.`,
        });
      }
    });
  };

  // Executa uma ação administrativa remota (Pilar 3)
  const handleAdminAction = (action, options = {}) => {
    const isPlayerOffline = Boolean(activePlayer?.isOffline || (!activePlayer?.onlineId && !activePlayer?.id));
    const targetPlayerId = activePlayer?.onlineId || (isPlayerOffline ? 0 : activePlayer?.id) || 0;
    const citizenid = activePlayer?.citizenid || activePlayer?.dossier?.citizenid || dossierData?.citizenid;
    const license = activePlayer?.license || activePlayer?.dossier?.license;

    if (!isPlayerOffline && !targetPlayerId) return;
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
        targetPlayerId,
        options: {
          ...options,
          citizenid,
          license,
          isOffline: isPlayerOffline,
        },
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
          if (action === 'mute_voice') {
            setIsVoiceMuted(response.isMuted !== undefined ? response.isMuted : !isVoiceMuted);
          }
          if (action === 'mute_chat') {
            setIsChatMuted(response.isMuted !== undefined ? response.isMuted : !isChatMuted);
          }
          if (action === 'freeze') {
            const nextFrozen = response.isFrozen !== undefined ? response.isFrozen : !isFrozen;
            setIsFrozen(nextFrozen);
            setActivePlayer((prev) => (prev ? { ...prev, isFrozen: nextFrozen } : prev));
          }
          if (['jail', 'unjail', 'reduce_jail', 'set_jail_time'].includes(action)) {
            fetchPrisonerStatus();
          }
          if (['set_job', 'set_gang', 'manage_money'].includes(action)) {
            setTimeout(fetchDossier, 800);
            setEditingJob(false);
            setEditingGang(false);
          }
          if (['store_player_vehicle', 'spawn_player_vehicle', 'release_player_vehicle', 'impound_player_vehicle', 'repair_vehicle'].includes(action)) {
            setTimeout(fetchPlayerVehicles, 800);
          }
          if (['give_item', 'remove_item', 'strip_weapons', 'clear_inventory'].includes(action)) {
            setTimeout(fetchInventory, 800);
            setGiveItemOpen(false);
            setGiveItemName('');
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

  if (!activePlayer) return null;
  const player = activePlayer;

  const dossier = dossierData || player.dossier || {};
  const vehicle = player.vehicle;

  const citizenId = activePlayer.citizenid || dossier.citizenid || 'N/A';
  const charFullName = `${activePlayer.charinfo?.firstname || dossier.charinfo?.firstname || dossier.firstname || ''} ${activePlayer.charinfo?.lastname || dossier.charinfo?.lastname || dossier.lastname || ''}`.trim();
  const charRPName = charFullName || activePlayer.characterName || (activePlayer.charinfo?.name || 'Cidadão');
  const steamAccountName = activePlayer.steamName || activePlayer.name || dossier.name || 'N/A';
  const slotNum = Number((activePlayer.cid !== undefined && activePlayer.cid !== null) ? activePlayer.cid : (activePlayer.charinfo?.cid || dossier.cid || 1));

  // Filtro de itens no inventário
  const filteredItems = (inventoryData?.items || []).filter((item) => {
    const q = invSearch.toLowerCase();
    return (
      (item.label && item.label.toLowerCase().includes(q)) ||
      (item.name && item.name.toLowerCase().includes(q))
    );
  });

  // Filtro de itens do catálogo completo ox_inventory
  const filteredCatalog = useMemo(() => {
    const normalize = (txt) => (txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const q = normalize(catalogSearch);
    return itemsCatalog.filter((it) => {
      const itNameLower = (it.name || '').toLowerCase();
      const itLabelLower = (it.label || '').toLowerCase();
      const itCategory = it.category || 'all';
      const itType = it.type || 'item';

      if (catalogCategory === 'weapons') {
        const isWep = itCategory === 'weapons' || itType === 'weapon' || itNameLower.startsWith('weapon_') || itNameLower.startsWith('wep_');
        if (!isWep) return false;
      } else if (catalogCategory === 'ammo') {
        const isAmmo = itCategory === 'ammo' || itType === 'ammo' || itNameLower.startsWith('ammo-') || itNameLower.startsWith('ammo_') || itNameLower.endsWith('_ammo') || itLabelLower.includes('munição');
        if (!isAmmo) return false;
      } else if (catalogCategory === 'consumables') {
        if (itCategory === 'consumables') {
          // match
        } else {
          const isFood = itNameLower.includes('water') || itNameLower.includes('bread') || itNameLower.includes('food') || itNameLower.includes('drink') ||
                         itNameLower.includes('burger') || itNameLower.includes('pizza') || itNameLower.includes('beer') || itNameLower.includes('pipoca') ||
                         itNameLower.includes('sanduiche') || itNameLower.includes('batata') || itLabelLower.includes('água') || itLabelLower.includes('pão') ||
                         itLabelLower.includes('suco') || itLabelLower.includes('lanche') || itLabelLower.includes('cerveja');
          if (!isFood) return false;
        }
      } else if (catalogCategory === 'medical') {
        if (itCategory === 'medical') {
          // match
        } else {
          const isMed = itNameLower.includes('med') || itNameLower.includes('bandage') || itNameLower.includes('pill') || itNameLower.includes('firstaid') ||
                        itLabelLower.includes('curativo') || itLabelLower.includes('kit') || itLabelLower.includes('remédio') || itLabelLower.includes('gaze');
          if (!isMed) return false;
        }
      } else if (catalogCategory === 'tools') {
        if (itCategory === 'tools') {
          // match
        } else {
          const isTool = itNameLower.includes('lockpick') || itNameLower.includes('drill') || itNameLower.includes('radio') || itNameLower.includes('phone') ||
                         itNameLower.includes('repair') || itLabelLower.includes('chave') || itLabelLower.includes('ferramenta') || itLabelLower.includes('rádio') ||
                         itLabelLower.includes('celular') || itLabelLower.includes('lockpick');
          if (!isTool) return false;
        }
      }

      if (!q) return true;
      const n = normalize(it.name);
      const l = normalize(it.label);
      return n.includes(q) || l.includes(q);
    });
  }, [itemsCatalog, catalogSearch, catalogCategory]);

  // Lista de empregos e facções formatada para dropdowns
  const availableJobsList = Object.values(serverJobs).length > 0 ? Object.values(serverJobs) : [
    { name: 'unemployed', label: 'Civil / Desempregado', grades: { 0: { name: 'Desempregado' } } },
    { name: 'police', label: 'Polícia Militar', grades: { 0: { name: 'Recruta' }, 1: { name: 'Soldado' }, 2: { name: 'Cabo' }, 3: { name: 'Sargento' }, 4: { name: 'Tenente' }, 5: { name: 'Comandante' } } },
    { name: 'ambulance', label: 'SAMU / Hospital', grades: { 0: { name: 'Estagiário' }, 1: { name: 'Paramédico' }, 2: { name: 'Médico' }, 3: { name: 'Diretor' } } },
    { name: 'mechanic', label: 'Mecânica Central', grades: { 0: { name: 'Auxiliar' }, 1: { name: 'Mecânico' }, 2: { name: 'Chefe' } } },
  ];

  const availableGangsList = Object.values(serverGangs).length > 0 ? Object.values(serverGangs) : [
    { name: 'none', label: 'Nenhuma', grades: { 0: { name: 'Nenhum' } } },
    { name: 'ballas', label: 'Ballas', grades: { 0: { name: 'Aviãozinho' }, 1: { name: 'Membro' }, 2: { name: 'Gerente' }, 3: { name: 'Líder' } } },
    { name: 'families', label: 'Families', grades: { 0: { name: 'Aviãozinho' }, 1: { name: 'Membro' }, 2: { name: 'Gerente' }, 3: { name: 'Líder' } } },
    { name: 'vagos', label: 'Vagos', grades: { 0: { name: 'Aviãozinho' }, 1: { name: 'Membro' }, 2: { name: 'Gerente' }, 3: { name: 'Líder' } } },
  ];

  const currentJobGrades = selectedJob && serverJobs[selectedJob]?.grades ? serverJobs[selectedJob].grades : {};
  const currentGangGrades = selectedGang && serverGangs[selectedGang]?.grades ? serverGangs[selectedGang].grades : {};

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
            <div
              className="dossier-avatar"
              style={{
                background: isOffline ? 'rgba(148, 163, 184, 0.12)' : 'var(--color-accent-dim)',
                color: isOffline ? '#94a3b8' : 'var(--color-accent)',
                borderColor: isOffline ? 'rgba(148, 163, 184, 0.25)' : 'rgba(52, 211, 153, 0.3)',
              }}
            >
              {isOffline ? 'OFF' : `#${activePlayer.id || activePlayer.onlineId}`}
            </div>
            <div className="dossier-titles">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div className="dossier-char-name">
                  {charRPName}
                </div>
                <span className="badge-citizenid font-mono" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                  Slot #{slotNum}
                </span>
                <span className={`offline-badge ${isOffline ? 'offline' : 'online'}`}>
                  {isOffline ? 'OFFLINE (BASE SQL)' : 'ONLINE'}
                </span>
                {isStreaming && (
                  <span
                    className="badge-citizenid font-mono"
                    style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      color: '#10b981',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Eye size={13} weight="fill" />
                    <span>PiP ATIVO</span>
                  </span>
                )}
              </div>
              <div className="dossier-sub-name">
                Conta FiveM: <span className="font-mono">{steamAccountName}</span>
                {citizenId && citizenId !== 'N/A' && (
                  <span className="badge-citizenid">CID: {citizenId}</span>
                )}
              </div>
            </div>
          </div>

          <div className="dossier-header-actions">
            {!isOffline && (
              <button
                className={`btn-dossier-stream ${isStreaming ? 'active' : ''}`}
                onClick={() => {
                  if (isStreaming && onStopStream) {
                    onStopStream(activePlayer.id || activePlayer.onlineId);
                  } else if (onStartStream) {
                    onStartStream(activePlayer.id || activePlayer.onlineId);
                  }
                }}
                title={isStreaming ? 'Encerrar telagem em segundo plano' : 'Iniciar telagem ao vivo (PiP flutuante)'}
              >
                {isStreaming ? (
                  <>
                    <EyeSlash size={16} weight="bold" />
                    <span>Fechar PiP</span>
                  </>
                ) : (
                  <>
                    <Eye size={16} weight="bold" />
                    <span>Telar em PiP</span>
                  </>
                )}
              </button>
            )}
            <button className="btn-icon" onClick={onClose} title="Fechar Dossiê">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Barra Seletora de Personagens da Conta (Multichar) */}
        {accountCharacters.length > 1 && (
          <div className="multichar-selector-bar">
            <div className="multichar-label">
              <UserSwitch size={15} weight="bold" />
              <span>Personagens da Conta ({accountCharacters.length}):</span>
            </div>
            <div className="multichar-slots-row">
              {accountCharacters.map((char) => {
                const isCurrent = char.citizenid === (activePlayer.citizenid || dossierData?.citizenid);
                const isCharOnline = Boolean(char.isOnline);
                const charSlot = Number((char.cid !== undefined && char.cid !== null) ? char.cid : (char.charinfo?.cid || 1));
                const charSlotName = (char.charinfo?.firstname && char.charinfo?.lastname)
                  ? `${char.charinfo.firstname} ${char.charinfo.lastname}`
                  : (char.characterName || char.name || 'Cidadão');
                return (
                  <button
                    key={char.citizenid}
                    type="button"
                    className={`multichar-slot-btn ${isCurrent ? 'active' : ''}`}
                    onClick={() => handleSelectCharacter(char)}
                  >
                    <span className="slot-badge font-mono">Slot #{charSlot}</span>
                    <span className="slot-name">{charSlotName}</span>
                    <span
                      className={`slot-status-dot ${isCharOnline ? 'online' : 'offline'}`}
                      title={isCharOnline ? 'Online no servidor' : 'Offline'}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
            className={`dossier-tab ${activeTab === 'vehicle' ? 'active' : ''}`}
            onClick={() => setActiveTab('vehicle')}
          >
            <Car size={16} weight="bold" />
            <span>Veículos & Garagem</span>
            {ownedVehicles?.length > 0 && (
              <span className="tab-badge">{ownedVehicles.length}</span>
            )}
          </button>
          <button
            className={`dossier-tab ${activeTab === 'moderation' ? 'active' : ''}`}
            onClick={() => setActiveTab('moderation')}
          >
            <ShieldWarning size={16} weight="bold" />
            <span>Moderação & Prisão</span>
            {isFrozen && <span className="tab-badge danger">FROZEN</span>}
            {prisonerStatus?.inPrison && <span className="tab-badge danger">PRESO</span>}
          </button>
        </div>

        {/* Conteúdo das Abas */}
        <div className="dossier-body">
          {/* ════ ABA 1: DOSSIÊ DO CIDADÃO (PILAR 2) ════ */}
          {activeTab === 'dossier' && (
            <div className="dossier-tab-content">
              {dossierLoading && !dossier.citizenid && !dossier.job ? (
                <div className="dossier-loading-state">
                  <ArrowsClockwise size={32} className="spin text-accent" />
                  <p>Consultando Dossiê do Cidadão no QBX Core...</p>
                </div>
              ) : (
                <>
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
                        <Briefcase size={16} weight="fill" className="text-accent" />
                        <span>Ocupação Principal</span>
                      </div>
                      <div className="dossier-stat-value text-accent" style={{ fontSize: '1rem' }}>
                        {dossier.job?.label || 'Civil'}
                      </div>
                      <div className="dossier-stat-sub">
                        <span>Grau: {formatGradeLabel(dossier.job)}</span>
                        {dossier.job?.onduty && <span className="badge-duty">EM SERVIÇO</span>}
                      </div>
                    </div>
                  </div>

                  {/* Gestão Financeira 3 Cards */}
                  <div className="finance-cards-row">
                    <div className="finance-card cash">
                      <div className="finance-card-label">
                        <Coins size={15} weight="bold" style={{ color: '#10b981' }} />
                        <span>Dinheiro em Carteira</span>
                      </div>
                      <div className="finance-card-value" style={{ color: '#10b981' }}>
                        R$ {(dossier.money?.cash ?? 0).toLocaleString('pt-BR')}
                      </div>
                    </div>

                    <div className="finance-card bank">
                      <div className="finance-card-label">
                        <Coins size={15} weight="bold" style={{ color: '#38bdf8' }} />
                        <span>Saldo em Conta Bancária</span>
                      </div>
                      <div className="finance-card-value" style={{ color: '#38bdf8' }}>
                        R$ {(dossier.money?.bank ?? 0).toLocaleString('pt-BR')}
                      </div>
                    </div>

                    <div className="finance-card gems">
                      <div className="finance-card-label">
                        <Sparkle size={15} weight="bold" style={{ color: '#06b6d4' }} />
                        <span>Gemas VIP (dp_sistema_gemas)</span>
                      </div>
                      <div className="finance-card-value" style={{ color: '#06b6d4' }}>
                        💎 {(dossier.money?.gems ?? 0).toLocaleString('pt-BR')}
                      </div>
                    </div>
                  </div>

                  {/* Formulário de Gestão Financeira Rápida */}
                  <div className="dossier-stat-card" style={{ marginTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '6px' }}>
                      <div className="dossier-stat-label">
                        <Coins size={16} weight="fill" className="text-accent" />
                        <span>Operação Financeira {isOffline ? '(Persistido SQL)' : '(QBX Core)'}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {[
                          { label: '+10k', amt: 10000, acc: 'bank' },
                          { label: '+50k', amt: 50000, acc: 'bank' },
                          { label: '+100k', amt: 100000, acc: 'bank' },
                          { label: '+1M', amt: 1000000, acc: 'bank' },
                          { label: '+50 💎', amt: 50, acc: 'gems' },
                          { label: '+200 💎', amt: 200, acc: 'gems' },
                        ].map((preset, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="teleport-chip"
                            style={{ fontSize: '0.7rem', padding: '3px 8px' }}
                            onClick={() => {
                              setMoneyAccount(preset.acc);
                              setMoneyOp('add');
                              setMoneyAmount(String(preset.amt));
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="money-form-row">
                      <select value={moneyAccount} onChange={(e) => setMoneyAccount(e.target.value)}>
                        <option value="bank">Banco</option>
                        <option value="cash">Carteira (Cash)</option>
                        <option value="gems">💎 Gemas VIP</option>
                        <option value="crypto">Cripto</option>
                      </select>
                      <select value={moneyOp} onChange={(e) => setMoneyOp(e.target.value)}>
                        <option value="add">Adicionar (+)</option>
                        <option value="remove">Remover (-)</option>
                        <option value="set">Definir (=)</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Valor numérico..."
                        value={moneyAmount}
                        onChange={(e) => setMoneyAmount(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        disabled={actionLoading || !moneyAmount || Number(moneyAmount) <= 0}
                        onClick={() => {
                          const amt = parseInt(moneyAmount);
                          if (!amt || amt <= 0) return;
                          handleAdminAction('manage_money', {
                            account: moneyAccount,
                            operation: moneyOp,
                            amount: amt,
                          });
                          setMoneyAmount('');
                        }}
                      >
                        {actionLoading ? 'Aplicando...' : 'Aplicar'}
                      </button>
                    </div>
                  </div>

                  {/* Informações de Trabalho e Organização (SetJob & SetGang) */}
                  <div className="dossier-section">
                    <h3>Ocupação & Envolvimento (QBX Core)</h3>
                    <div className="dossier-info-grid">
                      {/* Emprego / Cargo */}
                      <div className="dossier-info-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Briefcase size={18} className="text-secondary" />
                            <div>
                              <div className="dossier-info-label">Emprego / Trabalho</div>
                              <div className="dossier-info-val">
                                {dossier.job?.label || 'Civil / Desempregado'} —{' '}
                                <span className="text-secondary">
                                  {formatGradeLabel(dossier.job)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn-icon"
                            style={{ width: '28px', height: '28px', background: 'rgba(255, 255, 255, 0.05)' }}
                            title="Alterar Emprego do Cidadão"
                            onClick={() => {
                              setSelectedJob(dossier.job?.name || 'unemployed');
                              setSelectedJobGrade(extractGradeLevel(dossier.job));
                              setEditingJob(!editingJob);
                            }}
                          >
                            <PencilSimple size={15} />
                          </button>
                        </div>

                        {editingJob && (
                          <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                              Alterar Emprego ({isOffline ? 'Persistência Offline SQL' : 'QBX Core em Tempo Real'}):
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <select
                                style={{ flex: 1, minWidth: '140px', background: '#090d16', border: '1px solid var(--color-border)', color: '#fff', padding: '6px', borderRadius: '4px', fontSize: '0.8rem' }}
                                value={selectedJob}
                                onChange={(e) => {
                                  setSelectedJob(e.target.value);
                                  setSelectedJobGrade(0);
                                }}
                              >
                                {availableJobsList.map((j) => (
                                  <option key={j.name} value={j.name}>
                                    {j.label} ({j.name})
                                  </option>
                                ))}
                              </select>

                              <select
                                style={{ width: '130px', background: '#090d16', border: '1px solid var(--color-border)', color: '#fff', padding: '6px', borderRadius: '4px', fontSize: '0.8rem' }}
                                value={selectedJobGrade}
                                onChange={(e) => setSelectedJobGrade(parseInt(e.target.value) || 0)}
                              >
                                {Object.keys(currentJobGrades).length > 0 ? (
                                  Object.entries(currentJobGrades).map(([lvl, g]) => (
                                    <option key={lvl} value={lvl}>
                                      Grau {lvl}: {g.name}
                                    </option>
                                  ))
                                ) : (
                                  [0, 1, 2, 3, 4, 5].map((lvl) => (
                                    <option key={lvl} value={lvl}>
                                      Grau {lvl}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                style={{ padding: '5px 10px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--color-border)', color: '#94a3b8', borderRadius: '4px' }}
                                onClick={() => setEditingJob(false)}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                style={{ padding: '5px 12px', fontSize: '0.75rem', background: 'var(--color-primary, #10b981)', border: 'none', color: '#000', fontWeight: 700, borderRadius: '4px' }}
                                disabled={actionLoading}
                                onClick={() => {
                                  handleAdminAction('set_job', {
                                    job: selectedJob,
                                    grade: selectedJobGrade,
                                  });
                                }}
                              >
                                Salvar Emprego
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Facção / Gangue */}
                      <div className="dossier-info-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <UsersThree size={18} className="text-secondary" />
                            <div>
                              <div className="dossier-info-label">Facção / Organização</div>
                              <div className="dossier-info-val">
                                {dossier.gang?.label || 'Nenhuma'} —{' '}
                                <span className="text-secondary">
                                  {formatGradeLabel(dossier.gang)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn-icon"
                            style={{ width: '28px', height: '28px', background: 'rgba(255, 255, 255, 0.05)' }}
                            title="Alterar Facção do Cidadão"
                            onClick={() => {
                              setSelectedGang(dossier.gang?.name || 'none');
                              setSelectedGangGrade(extractGradeLevel(dossier.gang));
                              setEditingGang(!editingGang);
                            }}
                          >
                            <PencilSimple size={15} />
                          </button>
                        </div>

                        {editingGang && (
                          <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                              Alterar Facção ({isOffline ? 'Persistência Offline SQL' : 'QBX Core em Tempo Real'}):
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <select
                                style={{ flex: 1, minWidth: '140px', background: '#090d16', border: '1px solid var(--color-border)', color: '#fff', padding: '6px', borderRadius: '4px', fontSize: '0.8rem' }}
                                value={selectedGang}
                                onChange={(e) => {
                                  setSelectedGang(e.target.value);
                                  setSelectedGangGrade(0);
                                }}
                              >
                                {availableGangsList.map((g) => (
                                  <option key={g.name} value={g.name}>
                                    {g.label} ({g.name})
                                  </option>
                                ))}
                              </select>

                              <select
                                style={{ width: '130px', background: '#090d16', border: '1px solid var(--color-border)', color: '#fff', padding: '6px', borderRadius: '4px', fontSize: '0.8rem' }}
                                value={selectedGangGrade}
                                onChange={(e) => setSelectedGangGrade(parseInt(e.target.value) || 0)}
                              >
                                {Object.keys(currentGangGrades).length > 0 ? (
                                  Object.entries(currentGangGrades).map(([lvl, gr]) => (
                                    <option key={lvl} value={lvl}>
                                      Grau {lvl}: {gr.name}
                                    </option>
                                  ))
                                ) : (
                                  [0, 1, 2, 3, 4, 5].map((lvl) => (
                                    <option key={lvl} value={lvl}>
                                      Grau {lvl}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                style={{ padding: '5px 10px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--color-border)', color: '#94a3b8', borderRadius: '4px' }}
                                onClick={() => setEditingGang(false)}
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                style={{ padding: '5px 12px', fontSize: '0.75rem', background: 'var(--color-primary, #10b981)', border: 'none', color: '#000', fontWeight: 700, borderRadius: '4px' }}
                                disabled={actionLoading}
                                onClick={() => {
                                  handleAdminAction('set_gang', {
                                    gang: selectedGang,
                                    grade: selectedGangGrade,
                                  });
                                }}
                              >
                                Salvar Facção
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Telefone */}
                      <div className="dossier-info-item">
                        <Phone size={18} className="text-secondary" />
                        <div>
                          <div className="dossier-info-label">Telefone Registrado</div>
                          <div className="dossier-info-val font-mono">
                            {dossier.phone || 'Sem registro'}
                          </div>
                        </div>
                      </div>

                      {/* Coordenadas Atuais */}
                      <div className="dossier-info-item">
                        <MapPin size={18} className="text-secondary" />
                        <div>
                          <div className="dossier-info-label">Coordenadas Atuais</div>
                          <div className="dossier-info-val font-mono text-secondary">
                            {player.x !== undefined ? `X: ${player.x.toFixed(1)}, Y: ${player.y.toFixed(1)}, Z: ${player.z.toFixed(1)}` : 'Desconectado'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ════ ABA 2: INVENTÁRIO OX_INVENTORY (PILAR 2) ════ */}
          {activeTab === 'inventory' && (
            <div className="dossier-tab-content">
              {/* Barra de Peso e Ações do Inventário */}
              <div className="inv-header">
                <div className="inv-weight-info">
                  <div className="inv-weight-labels">
                    <span className="inv-weight-title">
                      Capacidade de Carga ({isOffline ? 'Inventário Offline' : 'ox_inventory'})
                    </span>
                    <span className="inv-weight-val font-mono">
                      {((inventoryData?.weight || 0) / 1000).toFixed(1)} /{' '}
                      {((inventoryData?.maxWeight || 30000) / 1000).toFixed(0)} kg
                    </span>
                  </div>
                  <div className="inv-weight-track">
                    <div
                      className="inv-weight-fill"
                      style={{
                        width: `${Math.min(100, ((inventoryData?.weight || 0) / (inventoryData?.maxWeight || 30000)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="inv-actions-row">
                  <button
                    className="btn-inv-action add"
                    onClick={() => setGiveItemOpen(!giveItemOpen)}
                    disabled={actionLoading}
                  >
                    <Plus size={16} weight="bold" />
                    <span>Injetar Item</span>
                  </button>
                  <button
                    className="btn-inv-action"
                    onClick={() => setIsCatalogModalOpen(true)}
                    title="Explorar e buscar itens do servidor por foto e nome"
                  >
                    <MagnifyingGlass size={16} weight="bold" />
                    <span>Catálogo de Itens</span>
                  </button>
                  <button
                    className="btn-inv-action strip"
                    onClick={() => {
                      if (confirm(`Confiscar todas as armas do inventário de ${charRPName}?`)) {
                        handleAdminAction('strip_weapons');
                      }
                    }}
                    disabled={actionLoading}
                  >
                    <Sword size={16} weight="bold" />
                    <span>Confiscar Armas</span>
                  </button>
                  <button
                    className="btn-inv-action wipe"
                    onClick={() => {
                      if (confirm(`ATENÇÃO: Limpar COMPLETAMENTE todos os itens de ${charRPName}? Esta ação é irreversível.`)) {
                        handleAdminAction('clear_inventory');
                      }
                    }}
                    disabled={actionLoading}
                  >
                    <Trash size={16} weight="bold" />
                    <span>Limpar Tudo</span>
                  </button>
                </div>
              </div>

              {/* Injeção de Item com Autocomplete */}
              {giveItemOpen && (
                <div className="give-item-card">
                  <div className="give-item-header">
                    <div className="give-item-title">
                      <Plus size={15} weight="bold" />
                      <span>
                        Injetar Item via ox_inventory ({itemsCatalog.length > 0 ? `${itemsCatalog.length} itens catalogados` : 'Catálogo Direto'})
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn-open-catalog"
                        onClick={() => setIsCatalogModalOpen(true)}
                        title="Explorar todos os itens disponíveis no servidor"
                      >
                        <MagnifyingGlass size={13} weight="bold" />
                        <span>Buscar no Catálogo</span>
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        style={{ width: '22px', height: '22px' }}
                        onClick={() => setGiveItemOpen(false)}
                        title="Fechar injeção de item"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="give-item-form-row">
                    <div style={{ flex: 1, position: 'relative' }}>
                      <input
                        type="text"
                        className="give-item-input"
                        placeholder="Nome ou código do item (ex: weapon_combatpistol, lockpick, bread)..."
                        value={giveItemName}
                        onChange={(e) => setGiveItemName(e.target.value)}
                      />

                      {/* Dropdown de sugestões do catálogo */}
                      {catalogSuggestions.length > 0 && (
                        <div className="item-suggest-dropdown">
                          {catalogSuggestions.map((item) => (
                            <div
                              key={item.name}
                              className="item-suggest-row"
                              onClick={() => {
                                setGiveItemName(item.name);
                                setCatalogSuggestions([]);
                              }}
                            >
                              <img
                                src={`/api/item-images/${item.name}.png`}
                                alt={item.name}
                                className="item-suggest-img"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                              <div className="item-suggest-info">
                                <span className="item-suggest-label">{item.label || item.name}</span>
                                <span className="item-suggest-name">{item.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <input
                      type="number"
                      className="give-item-qty-input"
                      min={1}
                      value={giveItemCount}
                      onChange={(e) => setGiveItemCount(parseInt(e.target.value) || 1)}
                    />

                    <button
                      type="button"
                      className="btn-give-item-submit"
                      disabled={actionLoading || !giveItemName.trim()}
                      onClick={() => {
                        handleAdminAction('give_item', {
                          item: giveItemName.trim().toLowerCase(),
                          count: parseInt(giveItemCount) || 1,
                        });
                      }}
                    >
                      <Plus size={14} weight="bold" />
                      <span>Injetar</span>
                    </button>
                  </div>

                  <div className="give-item-chips-row">
                    <span className="give-item-chips-label">Atalhos rápidos:</span>
                    {[1, 5, 10, 50, 100].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        className={`teleport-chip ${giveItemCount === qty ? 'active' : ''}`}
                        style={{ padding: '3px 9px', fontSize: '0.72rem' }}
                        onClick={() => setGiveItemCount(qty)}
                      >
                        x{qty}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Barra de Busca de Itens */}
              <div className="inv-search-bar">
                <MagnifyingGlass size={16} className="text-secondary" />
                <input
                  type="text"
                  placeholder="Pesquisar itens por nome, etiqueta ou identificador..."
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                />
                {invSearch && (
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ width: '20px', height: '20px' }}
                    onClick={() => setInvSearch('')}
                    title="Limpar pesquisa"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Grid de Itens */}
              {invLoading ? (
                <div className="dossier-loading-state">
                  <ArrowsClockwise size={32} className="spin text-accent" />
                  <p>Sincronizando inventário ox_inventory...</p>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="empty-sub-card">
                  <Backpack size={28} />
                  <span>{invSearch ? 'Nenhum item corresponde à pesquisa.' : 'Inventário totalmente vazio.'}</span>
                </div>
              ) : (
                <div className="inv-items-grid">
                  {filteredItems.map((item, idx) => {
                    const durability = item.durability !== undefined ? Number(item.durability) : 100;
                    return (
                      <div key={item.slot || idx} className="inv-item-card">
                        <div className="inv-item-header">
                          <span className="inv-slot-badge font-mono">#{item.slot}</span>
                          <div className="inv-header-right">
                            <span className="inv-count-badge font-mono">x{item.count}</span>
                            <button
                              type="button"
                              className="inv-item-del-btn"
                              title={`Remover 1x ${item.label || item.name} (Slot #${item.slot})`}
                              disabled={actionLoading}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Remover 1x ${item.label || item.name} do slot #${item.slot}?`)) {
                                  handleAdminAction('remove_item', {
                                    item: item.name,
                                    count: 1,
                                    slot: item.slot,
                                  });
                                }
                              }}
                            >
                              <Trash size={11} weight="bold" />
                            </button>
                          </div>
                        </div>

                        <div className="inv-item-icon-wrapper">
                          <img
                            src={`/api/item-images/${item.name}.png`}
                            alt={item.name}
                            className="inv-item-img"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.nextElementSibling;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <div className="inv-item-fallback" style={{ display: 'none' }}>
                            <Backpack size={26} className="text-secondary" />
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

          {/* ════ ABA 3: VEÍCULOS & GARAGEM DO CIDADÃO (PILAR 4) ════ */}
          {activeTab === 'vehicle' && (
            <div className="dossier-tab-content">
              {/* Veículo Ativo em Tempo Real (OneSync se dentro do carro) */}
              {vehicle?.inVehicle && (
                <div className="vehicle-panel" style={{ marginBottom: '16px' }}>
                  <div className="vehicle-telemetry-card">
                    <div className="vehicle-plate-badge">
                      <div className="plate-flag">BRASIL</div>
                      <div className="plate-text">{vehicle.plate || 'SEM PLACA'}</div>
                    </div>
                    <div className="vehicle-metrics">
                      <div className="metric-box">
                        <Car size={22} className="text-accent" />
                        <div>
                          <div className="metric-label">Veículo Atual (OneSync)</div>
                          <div className="metric-value">{vehicle.model || 'Veículo'}</div>
                        </div>
                      </div>
                      <div className="metric-box">
                        <Speedometer size={22} className="text-accent" />
                        <div>
                          <div className="metric-label">Velocidade</div>
                          <div className="metric-value font-mono">
                            {vehicle.speedKmH ? Math.round(vehicle.speedKmH) : 0} <span className="unit">km/h</span>
                          </div>
                        </div>
                      </div>
                      <div className="metric-box">
                        <Gauge size={22} className="text-accent" />
                        <div>
                          <div className="metric-label">Saúde do Motor</div>
                          <div className="metric-value font-mono">
                            {vehicle.enginePercent ?? 100}%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="vehicle-actions-row">
                    <button
                      className="btn-veh-action repair"
                      onClick={() => handleAdminAction('repair_vehicle', { plate: vehicle.plate })}
                      disabled={actionLoading}
                    >
                      <Wrench size={18} weight="bold" />
                      <span>Reparar Veículo Ativo</span>
                    </button>
                    <button
                      className="btn-veh-action delete"
                      onClick={() => {
                        if (confirm(`Deletar a entidade do veículo atual da rua?`)) {
                          handleAdminAction('delete_vehicle');
                        }
                      }}
                      disabled={actionLoading}
                    >
                      <Trash size={18} weight="bold" />
                      <span>Deletar da Rua</span>
                    </button>
                    <button
                      className="btn-veh-action trunk"
                      onClick={() => handleInspectVehicleTrunk(vehicle.plate, 'trunk', vehicle.model)}
                      disabled={trunkLoading}
                    >
                      <Package size={18} weight="bold" />
                      <span>Porta-Malas Ativo</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Painel de Inspeção de Baú Ativo (Trunk / Glovebox) */}
              {inspectingVehicle && (
                <div className="trunk-inspection-panel" style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Package size={22} weight="fill" className="text-accent" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>
                          Inspeção de Compartimento: [{inspectingVehicle.plate}] ({inspectingVehicle.displayName})
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                          Itens salvos no ox_inventory (memória ativa e persistência player_vehicles)
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="trunk-type-tabs">
                        <button
                          type="button"
                          className={`trunk-tab-btn ${trunkType === 'trunk' ? 'active' : ''}`}
                          onClick={() => handleInspectVehicleTrunk(inspectingVehicle.plate, 'trunk', inspectingVehicle.displayName)}
                        >
                          Porta-Malas
                        </button>
                        <button
                          type="button"
                          className={`trunk-tab-btn ${trunkType === 'glovebox' ? 'active' : ''}`}
                          onClick={() => handleInspectVehicleTrunk(inspectingVehicle.plate, 'glovebox', inspectingVehicle.displayName)}
                        >
                          Porta-Luvas
                        </button>
                      </div>

                      <button
                        className="btn-icon"
                        title="Fechar inspeção de baú"
                        onClick={() => {
                          setInspectingVehicle(null);
                          setTrunkInventory(null);
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>

                  {trunkLoading ? (
                    <div className="dossier-loading-state" style={{ padding: '20px' }}>
                      <ArrowsClockwise size={24} className="spin text-accent" />
                      <p>Consultando baú do veículo...</p>
                    </div>
                  ) : !trunkInventory?.items?.length ? (
                    <div className="empty-sub-card" style={{ padding: '20px' }}>
                      <Package size={24} />
                      <span>Compartimento {trunkType === 'glovebox' ? 'porta-luvas' : 'porta-malas'} vazio.</span>
                    </div>
                  ) : (
                    <div className="inv-items-grid" style={{ marginTop: '8px' }}>
                      {trunkInventory.items.map((it, idx) => (
                        <div key={it.slot || idx} className="inv-item-card">
                          <div className="inv-item-header">
                            <span className="inv-slot-badge font-mono">#{it.slot}</span>
                            <span className="inv-count-badge font-mono">x{it.count}</span>
                          </div>
                          <div className="inv-item-icon-wrapper">
                            <img
                              src={`/api/item-images/${it.name}.png`}
                              alt={it.name}
                              className="inv-item-img"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const fallback = e.currentTarget.nextElementSibling;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                            <div className="inv-item-fallback" style={{ display: 'none' }}>
                              <Package size={26} className="text-secondary" />
                            </div>
                          </div>
                          <div className="inv-item-info">
                            <div className="inv-item-label">{it.label || it.name}</div>
                            <div className="inv-item-meta font-mono">
                              {((it.weight * it.count) / 1000).toFixed(2)}kg
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Seção da Frota Completa de Veículos Registrados */}
              <div className="mod-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Car size={20} weight="bold" className="text-accent" />
                    <h3 style={{ margin: 0 }}>
                      Frota Registrada do Cidadão ({ownedVehicles.length} veículos)
                    </h3>
                  </div>
                  <button
                    className="btn-icon"
                    style={{ width: '28px', height: '28px' }}
                    title="Atualizar frota de veículos"
                    onClick={fetchPlayerVehicles}
                  >
                    <ArrowsClockwise size={15} className={loadingVehicles ? 'spin' : ''} />
                  </button>
                </div>

                {loadingVehicles ? (
                  <div className="dossier-loading-state">
                    <ArrowsClockwise size={32} className="spin text-accent" />
                    <p>Consultando garagem de veículos no MySQL...</p>
                  </div>
                ) : ownedVehicles.length === 0 ? (
                  <div className="empty-sub-card">
                    <Car size={32} />
                    <span>Nenhum veículo registrado em nome deste cidadão na base de dados.</span>
                  </div>
                ) : (
                  <div className="fleet-grid">
                    {ownedVehicles.map((veh) => {
                      // Status mapping: 1=Guardado, 0=Na Rua, 2=Apreendido, 3=Destruído
                      const isStored = veh.state === 1;
                      const isStreet = veh.state === 0 || veh.isSpawned;
                      const isImpounded = veh.state === 2;
                      const isDestroyed = veh.state === 3;

                      return (
                        <div key={veh.id || veh.plate} className="fleet-card">
                          <div className="fleet-card-header">
                            <div className="fleet-title-row">
                              <span className="fleet-veh-name">{veh.displayName || veh.model}</span>
                              <span className="fleet-garage-badge">
                                <FolderOpen size={12} />
                                {veh.garage || 'Garagem Principal'}
                              </span>
                            </div>

                            <span
                              className={`fleet-status-pill ${
                                isStored ? 'stored' : isStreet ? 'street' : isImpounded ? 'impounded' : 'destroyed'
                              }`}
                            >
                              {isStored ? '🅿️ Guardado' : isStreet ? '🚗 Na Rua' : isImpounded ? '🔒 Pátio' : '💥 Destruído'}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div className="vehicle-plate-badge" style={{ transform: 'scale(0.85)', transformOrigin: 'left center' }}>
                              <div className="plate-flag">BRASIL</div>
                              <div className="plate-text">{veh.plate}</div>
                            </div>
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                              Modelo: {veh.model}
                            </span>
                          </div>

                          {/* Barras de Telemetria / Condição */}
                          <div className="fleet-bars-grid">
                            <div className="fleet-bar-item">
                              <span className="fleet-bar-label">Motor</span>
                              <span className="fleet-bar-value" style={{ color: veh.engine < 400 ? '#ef4444' : '#10b981' }}>
                                {Math.round(veh.engine / 10)}%
                              </span>
                            </div>
                            <div className="fleet-bar-item">
                              <span className="fleet-bar-label">Lataria</span>
                              <span className="fleet-bar-value" style={{ color: veh.body < 400 ? '#ef4444' : '#38bdf8' }}>
                                {Math.round(veh.body / 10)}%
                              </span>
                            </div>
                            <div className="fleet-bar-item">
                              <span className="fleet-bar-label">Combustível</span>
                              <span className="fleet-bar-value" style={{ color: veh.fuel < 20 ? '#ef4444' : '#eab308' }}>
                                {Math.round(veh.fuel)}%
                              </span>
                            </div>
                          </div>

                          {/* Ações Rápidas no Veículo */}
                          <div className="fleet-actions-grid">
                            <button
                              type="button"
                              className="btn-fleet-action"
                              title="Inspecionar porta-malas do veículo"
                              onClick={() => handleInspectVehicleTrunk(veh.plate, 'trunk', veh.displayName || veh.model)}
                            >
                              <Package size={14} weight="bold" />
                              <span>Porta-Malas</span>
                            </button>

                            <button
                              type="button"
                              className="btn-fleet-action"
                              title="Inspecionar porta-luvas do veículo"
                              onClick={() => handleInspectVehicleTrunk(veh.plate, 'glovebox', veh.displayName || veh.model)}
                            >
                              <FolderOpen size={14} weight="bold" />
                              <span>Porta-Luvas</span>
                            </button>

                            <button
                              type="button"
                              className="btn-fleet-action primary"
                              title={isOffline ? 'Requer jogador online no servidor' : 'Trazer e spawnar veículo ao lado do jogador'}
                              disabled={actionLoading || isOffline}
                              onClick={() => {
                                handleAdminAction('spawn_player_vehicle', { plate: veh.plate });
                              }}
                            >
                              <Car size={14} weight="bold" />
                              <span>Spawnar ao Lado</span>
                            </button>

                            <button
                              type="button"
                              className="btn-fleet-action"
                              title="Guardar na garagem e apagar entidade física (DV)"
                              disabled={actionLoading}
                              onClick={() => {
                                handleAdminAction('store_player_vehicle', { plate: veh.plate });
                              }}
                            >
                              <FloppyDiskBack size={14} weight="bold" />
                              <span>Guardar (DV)</span>
                            </button>

                            <button
                              type="button"
                              className="btn-fleet-action"
                              title="Reparar lataria e motor a 100%"
                              disabled={actionLoading}
                              onClick={() => {
                                handleAdminAction('repair_vehicle', { plate: veh.plate });
                              }}
                            >
                              <Wrench size={14} weight="bold" />
                              <span>Reparar 100%</span>
                            </button>

                            {isImpounded ? (
                              <button
                                type="button"
                                className="btn-fleet-action primary"
                                title="Liberar veículo do pátio para a garagem"
                                disabled={actionLoading}
                                onClick={() => {
                                  handleAdminAction('release_player_vehicle', { plate: veh.plate });
                                }}
                              >
                                <LockKeyOpen size={14} weight="bold" />
                                <span>Liberar do Pátio</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-fleet-action danger"
                                title="Apreender veículo para o pátio"
                                disabled={actionLoading}
                                onClick={() => {
                                  const taxa = prompt(`Taxa de apreensão para [${veh.plate}] (R$):`, '2500');
                                  if (taxa !== null) {
                                    handleAdminAction('impound_player_vehicle', {
                                      plate: veh.plate,
                                      depotPrice: parseInt(taxa) || 2500,
                                    });
                                  }
                                }}
                              >
                                <Lock size={14} weight="bold" />
                                <span>Apreender</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Consulta Manual de Baú por Placa Avulsa */}
              <div className="mod-section" style={{ marginTop: '14px' }}>
                <h3>Consultar Outra Placa Avulsa</h3>
                <p style={{ fontSize: '0.76rem', color: '#94a3b8', marginBottom: '8px' }}>
                  Inspecione o baú de qualquer outro veículo do servidor informando a placa.
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Digite a placa (ex: BRA2E19)..."
                    value={customPlate}
                    onChange={(e) => setCustomPlate(e.target.value.toUpperCase())}
                    style={{
                      background: '#090d16',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: '#fff',
                      fontFamily: 'monospace',
                      flex: 1,
                    }}
                  />
                  <button
                    className="btn-fleet-action primary"
                    style={{ padding: '8px 16px', height: '38px' }}
                    disabled={trunkLoading || !customPlate.trim()}
                    onClick={() => handleInspectVehicleTrunk(customPlate.trim(), 'trunk', customPlate.trim())}
                  >
                    <Package size={16} weight="bold" />
                    <span>Inspecionar Placa</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ════ ABA 4: MODERAÇÃO, BANS & PRISÃO ADMINISTRATIVA (PILAR 3) ════ */}
          {activeTab === 'moderation' && (
            <div className="dossier-tab-content">
              {isOffline && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '0.8rem',
                    color: '#f87171',
                  }}
                >
                  <ShieldWarning size={20} weight="bold" />
                  <span>
                    <strong>Cidadão Desconectado (Base SQL):</strong> Prisão administrativa, banimentos, advertências e alterações de inventário/emprego são gravados com sucesso diretamente no banco de dados.
                  </span>
                </div>
              )}

              {/* Seção 1: Prisão Administrativa Completa (pickle_prisons) */}
              <div className="mod-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Lock size={18} weight="bold" style={{ color: prisonerStatus?.inPrison ? '#ef4444' : '#10b981' }} />
                    <h3 style={{ margin: 0 }}>
                      Prisão Administrativa (pickle_prisons) {isOffline && <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 'normal' }}>(Persistência SQL)</span>}
                    </h3>
                  </div>
                  <button
                    className="btn-icon"
                    style={{ width: '26px', height: '26px' }}
                    title="Atualizar status da prisão"
                    onClick={fetchPrisonerStatus}
                  >
                    <ArrowsClockwise size={14} className={loadingPrisoner ? 'spin' : ''} />
                  </button>
                </div>

                {prisonerStatus?.inPrison ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Alerta de Preso Ativo + Relógio em Tempo Real */}
                    <div
                      style={{
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Lock size={26} weight="fill" style={{ color: '#ef4444' }} />
                        <div>
                          <div style={{ fontWeight: 700, color: '#f87171', fontSize: '0.9rem' }}>
                            Cidadão Cumprindo Sentença na Penitenciária
                          </div>
                          <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                            Cela: <strong style={{ color: '#fff' }}>{prisonerStatus.prisonName || 'Padrão'}</strong> | Tempo restante: {' '}
                            <strong style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                              {Math.floor(prisonCountdown / 60)}m {String(prisonCountdown % 60).padStart(2, '0')}s
                            </strong>
                          </div>
                        </div>
                      </div>

                      {/* Botão de Alvará de Soltura Imediato */}
                      <button
                        className="btn-mod-action revive"
                        style={{ padding: '8px 16px', fontSize: '0.82rem', width: 'auto' }}
                        onClick={() => {
                          if (confirm(`Conceder alvará de soltura imediato (zerar pena/unjail) para ${charRPName}?`)) {
                            handleAdminAction('unjail');
                          }
                        }}
                        disabled={actionLoading}
                      >
                        <LockKeyOpen size={18} weight="bold" />
                        <span>Alvará de Soltura (Zerar Pena)</span>
                      </button>
                    </div>

                    {/* Chips Rápidos de Redução de Pena */}
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                        Redução Rápida de Pena:
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {[5, 10, 15, 30, 60].map((mins) => (
                          <button
                            key={mins}
                            className="teleport-chip"
                            style={{
                              borderColor: 'rgba(56, 189, 248, 0.3)',
                              background: 'rgba(56, 189, 248, 0.08)',
                              color: '#38bdf8',
                            }}
                            onClick={() => handleAdminAction('reduce_jail', { amount: mins })}
                            disabled={actionLoading}
                          >
                            <Minus size={12} weight="bold" />
                            <span>-{mins} Minutos</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Formulários de Redução Customizada e Tempo Exato */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type="number"
                          min={1}
                          value={reduceMinutes}
                          onChange={(e) => setReduceMinutes(e.target.value)}
                          style={{
                            width: '70px',
                            background: '#090d16',
                            border: '1px solid var(--color-border)',
                            borderRadius: '6px',
                            padding: '7px 10px',
                            color: '#fff',
                            fontSize: '0.8rem',
                          }}
                        />
                        <button
                          className="btn-mod-action"
                          style={{ flex: 1, padding: '7px 10px', fontSize: '0.78rem' }}
                          onClick={() => handleAdminAction('reduce_jail', { amount: parseInt(reduceMinutes) || 1 })}
                          disabled={actionLoading}
                        >
                          <Minus size={14} weight="bold" />
                          <span>Reduzir Pena (-X min)</span>
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type="number"
                          min={0}
                          value={setExactJailMinutes}
                          onChange={(e) => setSetExactJailMinutes(e.target.value)}
                          style={{
                            width: '70px',
                            background: '#090d16',
                            border: '1px solid var(--color-border)',
                            borderRadius: '6px',
                            padding: '7px 10px',
                            color: '#fff',
                            fontSize: '0.8rem',
                          }}
                        />
                        <button
                          className="btn-mod-action"
                          style={{ flex: 1, padding: '7px 10px', fontSize: '0.78rem' }}
                          onClick={() => handleAdminAction('set_jail_time', { time: parseInt(setExactJailMinutes) || 0 })}
                          disabled={actionLoading}
                        >
                          <Clock size={14} weight="bold" />
                          <span>Definir Tempo Restante</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                      style={{
                        background: 'rgba(16, 185, 129, 0.08)',
                        border: '1px solid rgba(16, 185, 129, 0.2)',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        fontSize: '0.8rem',
                        color: '#34d399',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <CheckCircle size={18} weight="fill" />
                      <span>O cidadão está em liberdade no momento (sem sentença de prisão ativa).</span>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {QUICK_JAIL_PRESETS.map((preset) => (
                        <button
                          key={preset.minutes}
                          type="button"
                          className="teleport-chip"
                          onClick={() => setJailTime(preset.minutes)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="number"
                        min={1}
                        value={jailTime}
                        onChange={(e) => setJailTime(e.target.value)}
                        style={{
                          width: '90px',
                          background: '#090d16',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          color: '#fff',
                          fontSize: '0.85rem',
                        }}
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>minutos</span>

                      <input
                        type="text"
                        placeholder="Motivo da prisão administrativa..."
                        value={jailReason}
                        onChange={(e) => setJailReason(e.target.value)}
                        style={{
                          flex: 1,
                          minWidth: '200px',
                          background: '#090d16',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          color: '#fff',
                          fontSize: '0.85rem',
                        }}
                      />

                      <button
                        className="btn-mod-action"
                        style={{ padding: '8px 16px', background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#ef4444' }}
                        onClick={() => {
                          handleAdminAction('jail', {
                            time: parseInt(jailTime) || 10,
                            reason: jailReason || 'Sentença administrativa via Dashboard',
                          });
                        }}
                        disabled={actionLoading}
                      >
                        <Lock size={18} weight="bold" />
                        <span>Mandar para a Prisão</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Seção 2: Ações Instantâneas */}
              <div className="mod-section">
                <h3>Ações Instantâneas de Intervenção</h3>
                <div className="mod-quick-actions-grid">
                  {/* Freeze / Unfreeze */}
                  <button
                    className={`btn-mod-action ${isFrozen ? 'unfreeze' : 'freeze'}`}
                    onClick={() => handleAdminAction('freeze', { toggle: !isFrozen })}
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'Requer jogador online no servidor' : undefined}
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
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'Requer jogador online no servidor' : undefined}
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
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'Requer jogador online no servidor' : undefined}
                  >
                    <Bandaids size={20} weight="bold" />
                    <div>
                      <div className="btn-mod-title">Curar (Heal)</div>
                      <div className="btn-mod-sub">200 HP + 100 Colete</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Seção 3: Silenciamento & Controle de Conduta */}
              <div className="mod-section">
                <h3>Silenciamento & Controle de Conduta</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                  {/* Toggle Mute de Voz */}
                  <button
                    className="btn-mod-action"
                    onClick={() => handleAdminAction('mute_voice', { toggle: !isVoiceMuted })}
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'Requer jogador online no servidor' : undefined}
                    style={{
                      border: isVoiceMuted ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--color-border)',
                      background: isVoiceMuted ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    }}
                  >
                    {isVoiceMuted ? (
                      <SpeakerSlash size={22} weight="bold" style={{ color: '#ef4444' }} />
                    ) : (
                      <SpeakerHigh size={22} weight="bold" style={{ color: 'var(--color-accent)' }} />
                    )}
                    <div>
                      <div className="btn-mod-title" style={{ color: isVoiceMuted ? '#ef4444' : '#fff' }}>
                        {isVoiceMuted ? 'Voz: Silenciado' : 'Voz: Ativa'}
                      </div>
                      <div className="btn-mod-sub">
                        {isVoiceMuted ? 'Clique para Desmutar' : 'Clique para Silenciar'}
                      </div>
                    </div>
                  </button>

                  {/* Toggle Mute de Chat */}
                  <button
                    className="btn-mod-action"
                    onClick={() => handleAdminAction('mute_chat', { toggle: !isChatMuted })}
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'Requer jogador online no servidor' : undefined}
                    style={{
                      border: isChatMuted ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid var(--color-border)',
                      background: isChatMuted ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    }}
                  >
                    {isChatMuted ? (
                      <ChatSlash size={22} weight="bold" style={{ color: '#ef4444' }} />
                    ) : (
                      <ChatText size={22} weight="bold" style={{ color: '#38bdf8' }} />
                    )}
                    <div>
                      <div className="btn-mod-title" style={{ color: isChatMuted ? '#ef4444' : '#fff' }}>
                        {isChatMuted ? 'Chat: Bloqueado' : 'Chat: Liberado'}
                      </div>
                      <div className="btn-mod-sub">
                        {isChatMuted ? 'Clique para Liberar' : 'Clique para Bloquear'}
                      </div>
                    </div>
                  </button>

                  {/* Puxar Jogador (Bring) */}
                  <button
                    className="btn-mod-action"
                    onClick={() => handleAdminAction('bring')}
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'Requer jogador online no servidor' : undefined}
                  >
                    <MapPin size={22} weight="bold" style={{ color: '#eab308' }} />
                    <div>
                      <div className="btn-mod-title">Puxar (Bring)</div>
                      <div className="btn-mod-sub">Trazer para a sala staff</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Seção 4: Teletransporte Remoto */}
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
                      disabled={actionLoading || isOffline}
                      title={isOffline ? 'Requer jogador online no servidor' : undefined}
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
                    disabled={actionLoading || isOffline}
                  >
                    Teleportar
                  </button>
                </div>
              </div>

              {/* Seção 5: Aviso na Tela (Warn / DM) */}
              <div className="mod-section">
                <h3>Aviso na Tela (Warn / Notificação)</h3>
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

              {/* Seção 6: Expulsão (Kick) */}
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
                    disabled={isOffline}
                  />
                  <button
                    className="btn-kick"
                    onClick={() => {
                      if (!confirm(`Tem certeza que deseja expulsar ${charRPName} (#${player.id})?`)) {
                        return;
                      }
                      handleAdminAction('kick', { reason: kickReason });
                    }}
                    disabled={actionLoading || isOffline}
                    title={isOffline ? 'O cidadão já está desconectado do servidor' : undefined}
                  >
                    <Prohibit size={16} weight="bold" />
                    <span>Expulsar</span>
                  </button>
                </div>
              </div>

              {/* Seção 7: Banimento Persistente (Tabela bans SQL) */}
              <div className="mod-section danger-zone">
                <h3>Banimento Persistente (Tabela bans SQL)</h3>
                <div className="mod-duration-chips">
                  {[
                    { label: '1 Hora', minutes: 60, perm: false },
                    { label: '12 Horas', minutes: 720, perm: false },
                    { label: '1 Dia', minutes: 1440, perm: false },
                    { label: '3 Dias', minutes: 4320, perm: false },
                    { label: '7 Dias', minutes: 10080, perm: false },
                    { label: '30 Dias', minutes: 43200, perm: false },
                    { label: 'Permanente', minutes: 0, perm: true },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      className={`duration-chip ${(isPermanentBan && chip.perm) || (!isPermanentBan && !chip.perm && banDuration === String(chip.minutes)) ? 'active' : ''}`}
                      onClick={() => {
                        setIsPermanentBan(chip.perm);
                        setBanDuration(String(chip.minutes));
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>

                <div className="kick-input-group" style={{ marginBottom: '8px' }}>
                  <input
                    type="text"
                    placeholder="Motivo formal do banimento..."
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                  />
                </div>

                <button
                  className="btn-ban"
                  disabled={actionLoading || !banReason.trim()}
                  onClick={() => {
                    const durationLabel = isPermanentBan ? 'PERMANENTE' : `${Math.round(parseInt(banDuration) / 60)} horas`;
                    const targetIdentifier = isOffline ? `OFFLINE (CID: ${dossier.citizenid || player.citizenid || 'N/A'})` : `#${player.id} (${charRPName})`;
                    if (confirm(`CONFIRMAÇÃO DE BANIMENTO:\n\nAlvo: ${targetIdentifier}\nDuração: ${durationLabel}\nMotivo: ${banReason}\n\nO registro será gravado diretamente na tabela bans do MySQL.`)) {
                      handleAdminAction('ban', {
                        reason: banReason,
                        isPermanent: isPermanentBan,
                        durationMinutes: parseInt(banDuration) || 0,
                      });
                    }
                  }}
                >
                  <Prohibit size={18} weight="bold" />
                  <span>APLICAR BANIMENTO PERSISTENTE</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </Motion.div>

      {/* ════════ MODAL SELETOR DE ITENS DO CATÁLOGO (OX_INVENTORY) ════════ */}
      {isCatalogModalOpen && (
        <div className="catalog-modal-backdrop" onClick={() => setIsCatalogModalOpen(false)}>
          <div className="catalog-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="catalog-modal-header">
              <div className="catalog-modal-title">
                <Package size={22} className="text-accent" weight="bold" />
                <div>
                  <h3>Catálogo de Itens do Servidor</h3>
                  <span>{filteredCatalog.length} de {itemsCatalog.length} itens catalogados no ox_inventory</span>
                </div>
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => setIsCatalogModalOpen(false)}
                title="Fechar catálogo"
              >
                <X size={18} />
              </button>
            </div>

            <div className="catalog-filter-bar">
              <div className="catalog-search-input-wrap">
                <MagnifyingGlass size={16} className="text-secondary" />
                <input
                  type="text"
                  placeholder="Pesquise por nome em português (ex: Pistola, Chave, Pão) ou código técnico (ex: bread, lockpick)..."
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  autoFocus
                />
                {catalogSearch && (
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ width: '18px', height: '18px' }}
                    onClick={() => setCatalogSearch('')}
                    title="Limpar filtro"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="catalog-pills-row">
                {[
                  { id: 'all', label: 'Todos os Itens' },
                  { id: 'weapons', label: '🔫 Armas' },
                  { id: 'ammo', label: '🎯 Munições' },
                  { id: 'consumables', label: '🍔 Comidas & Bebidas' },
                  { id: 'medical', label: '🩹 Primeiros Socorros' },
                  { id: 'tools', label: '🔧 Ferramentas' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`catalog-pill ${catalogCategory === cat.id ? 'active' : ''}`}
                    onClick={() => setCatalogCategory(cat.id)}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="catalog-items-body">
              {filteredCatalog.length === 0 ? (
                <div className="empty-sub-card" style={{ padding: '40px' }}>
                  <Package size={36} />
                  <span>Nenhum item corresponde à pesquisa "{catalogSearch}".</span>
                </div>
              ) : (
                <div className="catalog-grid">
                  {filteredCatalog.slice(0, catalogVisibleCount).map((it) => (
                    <div key={it.name} className="catalog-card">
                      <div className="catalog-card-icon">
                        <img
                          src={`/api/item-images/${it.name}.png`}
                          alt={it.name}
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      </div>
                      <div className="catalog-card-info">
                        <div className="catalog-card-label" title={it.label || it.name}>
                          {it.label || it.name}
                        </div>
                        <div className="catalog-card-name" title={it.name}>
                          {it.name}
                        </div>
                      </div>
                      <div className="catalog-card-footer">
                        <span className="catalog-card-weight">
                          {((it.weight || 0) / 1000).toFixed(2)}kg
                        </span>
                        <button
                          type="button"
                          className="btn-catalog-inject"
                          onClick={() => {
                            setGiveItemName(it.name);
                            setIsCatalogModalOpen(false);
                            setGiveItemOpen(true);
                          }}
                        >
                          Selecionar
                        </button>
                      </div>
                    </div>
                  ))}
                  {catalogVisibleCount < filteredCatalog.length && (
                    <div className="catalog-load-more-wrap">
                      <button
                        type="button"
                        className="btn-catalog-load-more"
                        onClick={() => setCatalogVisibleCount((prev) => prev + 120)}
                      >
                        Carregar Mais (+120 itens) — Restam {filteredCatalog.length - catalogVisibleCount}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
