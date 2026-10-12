/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  vanguard_dashboard — Server Script (main.js)               ║
 * ║  Telemetria RP, Integração OX/QBX, Ações Remotas & RPC      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Pilares implementados:
 * - Pilar 1: Conexão Socket.io direta com backend para RPC de moderação e auditoria
 * - Pilar 2: Telemetria RP (QBX Core: charinfo, job, gang, money; ox_inventory: itens/peso; OneSync: veículo)
 * - Pilar 3: Ações Administrativas Remotas 1-Clique (Freeze, Revive, Heal, Teleport, Warn, Kick)
 */

const http = require('http');
const crypto = require('crypto');
let ioClient = null;
try {
  const { io } = require('socket.io-client');
  ioClient = io;
} catch (e) {
  console.warn('[vanguard_dashboard] socket.io-client não encontrado no bundle local:', e.message);
}

// ─── Socket.io Connection to Backend Control Plane ─────────────
let serverSocket = null;
const BACKEND_URL = FW_CONFIG.SERVER_BACKEND_URL || 'http://127.0.0.1:3001';
const API_SECRET = FW_CONFIG.API_SECRET;

// Geração de Stream Tokens efêmeros assinados por jogador (Elimina vazamento de API_SECRET no NUI)
function generateStreamToken(playerId) {
  const timestamp = Date.now();
  const hmac = crypto.createHmac('sha256', API_SECRET).update(`${playerId}:${timestamp}`).digest('hex');
  return { token: `${hmac}.${timestamp}`, timestamp };
}

// Responde à solicitação de token pelo NUI do jogador cliente
onNet('vanguard_dashboard:server:requestStreamToken', () => {
  const src = source;
  if (!src || src <= 0) return;
  const tokenData = generateStreamToken(src);
  emitNet('vanguard_dashboard:client:setStreamToken', src, tokenData);
});

// Rastreamento local de moderação e cache de nomes RP
const frozenPlayers = new Set();
const voiceMutedPlayers = new Set();
const chatMutedPlayers = new Set();
const characterNameCache = new Map();
let activeAdminsCount = 0;
let lastTelemetrySentAt = 0;

function initServerSocket() {
  if (!ioClient || serverSocket) return;

  try {
    serverSocket = ioClient(BACKEND_URL, {
      auth: {
        role: 'fivem-server',
        secret: API_SECRET,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });

    serverSocket.on('connect', () => {
      console.log(`[vanguard_dashboard] ✓ Conectado ao backend de controle via Socket.io (${serverSocket.id})`);
    });

    serverSocket.on('admin_presence', (data) => {
      const count = Number(data?.count || 0);
      const prev = activeAdminsCount;
      activeAdminsCount = count;
      if (prev === 0 && count > 0) {
        console.log(`[vanguard_dashboard] Administrador conectado! Ativando telemetria em alta frequência.`);
        sendTelemetryNow();
      } else if (count === 0) {
        console.log(`[vanguard_dashboard] Zero administradores ativos. Telemetria colocada em modo econômico.`);
      }
    });

    serverSocket.on('disconnect', (reason) => {
      console.log(`[vanguard_dashboard] ✗ Desconectado do backend de controle: ${reason}`);
    });

    serverSocket.on('connect_error', (err) => {
      // Falha silenciosa de reconexão
    });

    // ─── RPC: Consulta em tempo real de Inventário (ox_inventory / offline) ───
    serverSocket.on('get_player_inventory', async (data, callback) => {
      let targetId = parseInt(data?.playerId) || 0;
      const citizenid = String(data?.citizenid || '').trim();

      // Se targetId <= 0 mas citizenid foi passado, verifica se está online
      if (targetId <= 0 && citizenid && exports?.qbx_core?.GetPlayerByCitizenId) {
        try {
          const qp = exports.qbx_core.GetPlayerByCitizenId(citizenid);
          if (qp?.PlayerData?.source) targetId = parseInt(qp.PlayerData.source);
        } catch (_e) {}
      }

      if (targetId > 0 && typeof GetPlayerName === 'function' && GetPlayerName(String(targetId))) {
        try {
          const inv = getPlayerInventoryData(targetId);
          if (inv && inv.items) {
            if (typeof callback === 'function') {
              callback({ success: true, inventory: inv });
              return;
            }
          }
        } catch (err) {
          console.error(`[vanguard_dashboard] Erro ao consultar ox_inventory para #${targetId}:`, err.message);
        }
      }

      // Fallback para inventário salvo no MySQL (offline)
      if (citizenid && exports?.oxmysql?.query_async) {
        try {
          const rows = await exports.oxmysql.query_async(
            'SELECT inventory FROM players WHERE citizenid = ? LIMIT 1',
            [citizenid]
          );
          if (rows && rows[0]) {
            const raw = rows[0].inventory;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
            const itemsList = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
            const items = [];
            let totalWeight = 0;

            for (const key of Object.keys(itemsList)) {
              const it = itemsList[key];
              if (!it || !it.name) continue;
              const weight = Number(it.weight) || 0;
              const count = Number(it.count) || 1;
              totalWeight += weight * count;
              items.push({
                slot: it.slot ?? (parseInt(key) + 1),
                name: it.name,
                label: it.label || it.name,
                count: count,
                weight: weight,
                durability: it.metadata?.durability ?? 100,
                serial: it.metadata?.serial || null,
                metadata: it.metadata || {},
              });
            }

            items.sort((a, b) => a.slot - b.slot);

            if (typeof callback === 'function') {
              callback({
                success: true,
                inventory: {
                  items,
                  weight: totalWeight,
                  maxWeight: 30000,
                  slots: 50,
                },
              });
              return;
            }
          }
        } catch (err) {
          console.error(`[vanguard_dashboard] Erro ao consultar inventário offline de CID ${citizenid}:`, err.message);
        }
      }

      if (typeof callback === 'function') callback({ success: false, error: 'Inventário não encontrado.' });
    });

    // ─── RPC: Consulta sob Demanda de Dossiê RP (QBX Core - Pilar 2) ──
    serverSocket.on('get_player_dossier', (data, callback) => {
      const targetId = parseInt(data?.playerId);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        if (typeof callback === 'function') callback({ success: false, error: 'ID de jogador inválido' });
        return;
      }

      try {
        const dossier = getPlayerDossierData(targetId);
        if (typeof callback === 'function') {
          if (dossier) {
            callback({ success: true, dossier });
          } else {
            callback({
              success: false,
              error: 'Dossiê não encontrado (personagem não carregado ou qbx_core indisponível).',
            });
          }
        }
      } catch (err) {
        console.error(`[vanguard_dashboard] Erro ao consultar dossiê para #${targetId}:`, err.message);
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    });

    // ─── RPC: Execução de Ações Administrativas Remotas ────────────
    serverSocket.on('admin_action', async (data, callback) => {
      const { action, targetPlayerId, options, adminName } = data || {};
      const targetId = parseInt(targetPlayerId) || 0;

      const globalActions = ['broadcast', 'set_weather', 'set_time', 'revoke_ban', 'get_server_bans', 'restart_resource'];
      const isGlobal = globalActions.includes(action);
      const isOfflineAction = Boolean(options?.citizenid || options?.isOffline);

      if (!isGlobal && !isOfflineAction && targetId <= 0) {
        if (typeof callback === 'function') callback({ success: false, error: 'ID de jogador inválido ou ausente.' });
        return;
      }

      console.log(`[vanguard_dashboard] [Ação Remota] ${adminName || 'Admin'} executou '${action}'${targetId > 0 ? ` em #${targetId}` : (options?.citizenid ? ` no Cidadão CID:${options.citizenid}` : ' (Global)')}`);

      try {
        const result = await executeAdminAction(action, targetId, options || {}, adminName || 'Administrador');
        if (typeof callback === 'function') {
          callback(result);
        }
      } catch (err) {
        console.error(`[vanguard_dashboard] Erro ao processar '${action}':`, err.message);
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message });
        }
      }
    });

    // ─── RPC: Busca de Cidadãos na Base de Dados (Online + Offline) ──
    serverSocket.on('search_database_players', async (data, callback) => {
      const query = String(data?.query || '').trim();
      if (!exports?.oxmysql?.query_async) {
        if (typeof callback === 'function') callback({ success: false, error: 'oxmysql indisponível no servidor.' });
        return;
      }

      try {
        let sql = 'SELECT id, citizenid, cid, license, name, charinfo, job, money, inventory, phone_number, last_logged_out, last_updated FROM players ORDER BY COALESCE(last_logged_out, last_updated) DESC LIMIT 40';
        let params = [];

        if (query) {
          sql = 'SELECT id, citizenid, cid, license, name, charinfo, job, money, inventory, phone_number, last_logged_out, last_updated FROM players WHERE name LIKE ? OR citizenid LIKE ? OR license LIKE ? OR phone_number LIKE ? OR charinfo LIKE ? ORDER BY COALESCE(last_logged_out, last_updated) DESC LIMIT 40';
          const wild = `%${query}%`;
          params = [wild, wild, wild, wild, wild];
        }

        const rows = await exports.oxmysql.query_async(sql, params);

        // Mapeia jogadores atualmente online no QBX Core
        const onlineCitizens = new Map();
        try {
          const numIds = GetNumPlayerIndices ? GetNumPlayerIndices() : 0;
          for (let i = 0; i < numIds; i++) {
            const idStr = GetPlayerFromIndex(i);
            const targetId = parseInt(idStr);
            if (exports?.qbx_core?.GetPlayer) {
              const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
              if (qbxPlayer?.PlayerData?.citizenid) {
                onlineCitizens.set(qbxPlayer.PlayerData.citizenid, targetId);
              }
            }
          }
        } catch (_e) {}

        const parsedList = (rows || []).map((row) => {
          let charinfo = {};
          let rawJob = {};
          let rawGang = {};
          let money = {};
          let inv = [];

          try { charinfo = typeof row.charinfo === 'string' ? JSON.parse(row.charinfo) : (row.charinfo || {}); } catch (_e) {}
          try { rawJob = typeof row.job === 'string' ? JSON.parse(row.job) : (row.job || {}); } catch (_e) {}
          try { rawGang = typeof row.gang === 'string' ? JSON.parse(row.gang) : (row.gang || {}); } catch (_e) {}
          try { money = typeof row.money === 'string' ? JSON.parse(row.money) : (row.money || {}); } catch (_e) {}
          try {
            const rawInv = typeof row.inventory === 'string' ? JSON.parse(row.inventory) : (row.inventory || []);
            inv = Array.isArray(rawInv) ? rawInv : Object.values(rawInv || {});
          } catch (_e) {}

          const jobGradeName = (typeof rawJob.grade === 'object' && rawJob.grade?.name) ? rawJob.grade.name : (rawJob.gradeName || 'Iniciante');
          const jobGradeLevel = (typeof rawJob.grade === 'object' && rawJob.grade?.level !== undefined) ? Number(rawJob.grade.level) : (Number(rawJob.grade) || 0);

          const gangGradeName = (typeof rawGang.grade === 'object' && rawGang.grade?.name) ? rawGang.grade.name : (rawGang.gradeName || 'Membro');
          const gangGradeLevel = (typeof rawGang.grade === 'object' && rawGang.grade?.level !== undefined) ? Number(rawGang.grade.level) : (Number(rawGang.grade) || 0);

          const job = {
            name: rawJob.name || 'unemployed',
            label: rawJob.label || 'Civil',
            gradeName: jobGradeName,
            gradeLevel: jobGradeLevel,
            grade: jobGradeLevel,
            onduty: Boolean(rawJob.onduty),
          };

          const gang = {
            name: rawGang.name || 'none',
            label: rawGang.label || 'Nenhuma',
            gradeName: gangGradeName,
            gradeLevel: gangGradeLevel,
            grade: gangGradeLevel,
          };

          const onlineId = onlineCitizens.get(row.citizenid) || null;
          const isOnline = Boolean(onlineId);

          const charinfoCid = Number(charinfo?.cid);
          const rawCid = (row.cid !== null && row.cid !== undefined) ? Number(row.cid) : (!isNaN(charinfoCid) ? charinfoCid : 1);
          const slotNum = (!isNaN(rawCid) && rawCid > 0) ? rawCid : ((!isNaN(charinfoCid) && charinfoCid > 0) ? charinfoCid : 1);

          const charFullName = `${charinfo?.firstname || ''} ${charinfo?.lastname || ''}`.trim();
          const characterName = charFullName || row.name || 'Cidadão';

          return {
            id: isOnline ? onlineId : 0,
            dbId: row.id,
            citizenid: row.citizenid,
            cid: slotNum,
            license: row.license,
            name: row.name,
            charinfo,
            job,
            gang,
            money,
            inventory: inv,
            phoneNumber: row.phone_number,
            lastLoggedOut: row.last_logged_out || row.last_updated,
            isOnline: isOnline,
            isOffline: !isOnline,
            onlineId: onlineId,
            characterName: characterName,
          };
        });

        if (typeof callback === 'function') {
          callback({ success: true, players: parsedList, citizens: parsedList });
        }
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message, players: [] });
      }
    });

    // ─── RPC: Todos os Personagens da Conta do Jogador (Multichar) ──
    serverSocket.on('get_player_characters', async (data, callback) => {
      const license = data?.license;
      const citizenid = data?.citizenid;
      const targetPlayerId = parseInt(data?.playerId) || 0;

      let targetLicense = license || null;

      if (!targetLicense && targetPlayerId > 0) {
        const idStr = String(targetPlayerId);
        const numIds = GetNumPlayerIdentifiers ? GetNumPlayerIdentifiers(idStr) : 0;
        for (let i = 0; i < numIds; i++) {
          const ident = GetPlayerIdentifier(idStr, i);
          if (ident && (ident.startsWith('license:') || ident.startsWith('license2:'))) {
            targetLicense = ident;
            break;
          }
        }
      }

      if (!targetLicense && citizenid && exports?.oxmysql?.query_async) {
        try {
          const row = await exports.oxmysql.query_async(
            'SELECT license FROM players WHERE citizenid = ? LIMIT 1',
            [citizenid]
          );
          if (row && row[0]) targetLicense = row[0].license;
        } catch (_e) {}
      }

      if (!targetLicense) {
        if (typeof callback === 'function') callback({ success: false, characters: [] });
        return;
      }

      try {
        const rows = await exports.oxmysql.query_async(
          'SELECT id, citizenid, cid, license, name, charinfo, job, gang, money, inventory, phone_number, last_logged_out, last_updated FROM players WHERE license = ? ORDER BY cid ASC',
          [targetLicense]
        );

        // Identifica qual personagem está online agora
        const onlineCitizens = new Map();
        try {
          const count = GetNumPlayerIndices ? GetNumPlayerIndices() : 0;
          for (let i = 0; i < count; i++) {
            const idStr = GetPlayerFromIndex(i);
            const pId = parseInt(idStr);
            if (exports?.qbx_core?.GetPlayer) {
              const qbx = exports.qbx_core.GetPlayer(pId);
              if (qbx?.PlayerData?.citizenid) {
                onlineCitizens.set(qbx.PlayerData.citizenid, pId);
              }
            }
          }
        } catch (_e) {}

        const chars = (rows || []).map((r) => {
          let charinfo = {};
          let rawJob = {};
          let rawGang = {};
          let money = {};
          let inv = [];
          try { charinfo = typeof r.charinfo === 'string' ? JSON.parse(r.charinfo) : (r.charinfo || {}); } catch (_e) {}
          try { rawJob = typeof r.job === 'string' ? JSON.parse(r.job) : (r.job || {}); } catch (_e) {}
          try { rawGang = typeof r.gang === 'string' ? JSON.parse(r.gang) : (r.gang || {}); } catch (_e) {}
          try { money = typeof r.money === 'string' ? JSON.parse(r.money) : (r.money || {}); } catch (_e) {}
          try {
            const raw = typeof r.inventory === 'string' ? JSON.parse(r.inventory) : (r.inventory || []);
            inv = Array.isArray(raw) ? raw : Object.values(raw || {});
          } catch (_e) {}

          const jobGradeName = (typeof rawJob.grade === 'object' && rawJob.grade?.name) ? rawJob.grade.name : (rawJob.gradeName || 'Iniciante');
          const jobGradeLevel = (typeof rawJob.grade === 'object' && rawJob.grade?.level !== undefined) ? Number(rawJob.grade.level) : (Number(rawJob.grade) || 0);

          const gangGradeName = (typeof rawGang.grade === 'object' && rawGang.grade?.name) ? rawGang.grade.name : (rawGang.gradeName || 'Membro');
          const gangGradeLevel = (typeof rawGang.grade === 'object' && rawGang.grade?.level !== undefined) ? Number(rawGang.grade.level) : (Number(rawGang.grade) || 0);

          const job = {
            name: rawJob.name || 'unemployed',
            label: rawJob.label || 'Civil',
            gradeName: jobGradeName,
            gradeLevel: jobGradeLevel,
            grade: jobGradeLevel,
            onduty: Boolean(rawJob.onduty),
          };

          const gang = {
            name: rawGang.name || 'none',
            label: rawGang.label || 'Nenhuma',
            gradeName: gangGradeName,
            gradeLevel: gangGradeLevel,
            grade: gangGradeLevel,
          };

          const onlineId = onlineCitizens.get(r.citizenid) || null;

          const charinfoCid = Number(charinfo?.cid);
          const rawCid = (r.cid !== null && r.cid !== undefined) ? Number(r.cid) : (!isNaN(charinfoCid) ? charinfoCid : 1);
          const slotNum = (!isNaN(rawCid) && rawCid > 0) ? rawCid : ((!isNaN(charinfoCid) && charinfoCid > 0) ? charinfoCid : 1);

          const charFullName = `${charinfo?.firstname || ''} ${charinfo?.lastname || ''}`.trim();
          const characterName = charFullName || r.name || 'Cidadão';

          return {
            id: onlineId || 0,
            dbId: r.id,
            citizenid: r.citizenid,
            cid: slotNum,
            license: r.license,
            name: r.name,
            charinfo,
            job,
            gang,
            money,
            inventory: inv,
            phoneNumber: r.phone_number,
            lastLoggedOut: r.last_logged_out || r.last_updated,
            isOnline: Boolean(onlineId),
            isOffline: !Boolean(onlineId),
            onlineId: onlineId,
            characterName: characterName,
          };
        });

        if (typeof callback === 'function') {
          callback({ success: true, characters: chars });
        }
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message, characters: [] });
      }
    });

    // ─── RPC: Consulta de Status Atual de Prisão (pickle_prisons) ──
    serverSocket.on('get_prisoner_status', async (data, callback) => {
      const targetId = parseInt(data?.playerId) || 0;
      const citizenid = data?.citizenid;

      let inPrison = false;
      let remainingMinutes = 0;
      let remainingSeconds = 0;
      let sentenceDate = null;
      let prisonName = 'default';
      let isOffline = false;

      // Checa online primeiro
      if (targetId > 0 && exports?.pickle_prisons?.GetPrisoner) {
        try {
          const prisoner = exports.pickle_prisons.GetPrisoner(targetId);
          if (prisoner && prisoner.time) {
            inPrison = true;
            remainingSeconds = Number(prisoner.time) || 0;
            remainingMinutes = Math.ceil(remainingSeconds / 60);
            prisonName = prisoner.index || prisoner.prison || 'default';
            sentenceDate = prisoner.sentence_date || null;
          }
        } catch (_e) {}
      }

      // Se não achou online ou estiver offline, busca no MySQL pickle_prisons
      if (!inPrison && citizenid && exports?.oxmysql?.query_async) {
        try {
          const rows = await exports.oxmysql.query_async(
            'SELECT time, prison, sentence_date FROM pickle_prisons WHERE identifier = ? LIMIT 1',
            [citizenid]
          );
          if (rows && rows[0]) {
            inPrison = true;
            remainingSeconds = Number(rows[0].time) || 0;
            remainingMinutes = Math.ceil(remainingSeconds / 60);
            prisonName = rows[0].prison || 'default';
            sentenceDate = rows[0].sentence_date || null;
            isOffline = true;
          }
        } catch (_e) {}
      }

      const elapsedMinutes = sentenceDate ? Math.max(0, Math.floor((Date.now() / 1000 - sentenceDate) / 60)) : 0;

      if (typeof callback === 'function') {
        callback({
          success: true,
          inPrison,
          remainingMinutes,
          remainingSeconds,
          sentenceDate,
          elapsedMinutes,
          prisonName,
          prisonLabel: prisonName === 'default' ? 'Boilingbroke Penitentiary' : prisonName,
          isOffline,
        });
      }
    });

    // ─── RPC: Consulta de Advertências Históricas (player_warns) ────
    serverSocket.on('get_player_warnings', async (data, callback) => {
      const targetId = parseInt(data?.playerId) || 0;
      let license = data?.license || null;

      if (targetId > 0 && !license) {
        const idStr = String(targetId);
        const numIds = GetNumPlayerIdentifiers(idStr);
        for (let i = 0; i < numIds; i++) {
          const ident = GetPlayerIdentifier(idStr, i);
          if (ident && ident.startsWith('license:')) {
            license = ident;
            break;
          }
        }
      }

      let warns = [];
      try {
        if (license && exports?.oxmysql?.query_async) {
          warns = await exports.oxmysql.query_async(
            'SELECT * FROM player_warns WHERE targetIdentifier = ? ORDER BY createdAt DESC LIMIT 25',
            [license]
          );
        }
      } catch (_e) {}

      if (typeof callback === 'function') {
        callback({ success: true, warnings: warns || [] });
      }
    });

    // ─── RPC: Inspeção de Inventário de Veículos (Memória + Fallback DB) ─
    serverSocket.on('get_vehicle_inventory', async (data, callback) => {
      const plate = String(data?.plate || '').trim();
      const type = String(data?.type || 'trunk').toLowerCase();
      if (!plate) {
        if (typeof callback === 'function') callback({ success: false, error: 'Placa não informada.' });
        return;
      }

      try {
        const invId = type === 'glovebox' ? ('glove' + plate) : ('trunk' + plate);
        let inv = null;
        if (exports?.ox_inventory?.GetInventory) {
          try {
            inv = exports.ox_inventory.GetInventory(invId);
          } catch (_e) {}
        }

        let items = [];
        if (inv && inv.items) {
          items = Array.isArray(inv.items) ? inv.items : Object.values(inv.items);
        } else if (exports?.oxmysql?.query_async) {
          try {
            const column = type === 'glovebox' ? 'glovebox' : 'trunk';
            const rows = await exports.oxmysql.query_async(
              `SELECT ${column} as invData FROM player_vehicles WHERE plate = ? LIMIT 1`,
              [plate]
            );
            if (rows && rows[0] && rows[0].invData) {
              const parsed = typeof rows[0].invData === 'string' ? JSON.parse(rows[0].invData) : rows[0].invData;
              items = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
            }
          } catch (_e) {}
        }

        if (typeof callback === 'function') {
          callback({
            success: true,
            inventory: {
              items: items || [],
              weight: inv?.weight || 0,
              maxWeight: inv?.maxWeight || 50000,
              slots: inv?.slots || 50,
            },
          });
        }
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message, inventory: { items: [] } });
      }
    });

    // ─── RPC: Consulta de Bans do Servidor ──────────────────────────
    serverSocket.on('get_server_bans', async (data, callback) => {
      try {
        let bans = [];
        if (exports?.oxmysql?.query_async) {
          bans = await exports.oxmysql.query_async(
            'SELECT id, name, license, discord, ip, reason, expire, bannedby FROM bans ORDER BY id DESC LIMIT 50',
            []
          );
        }
        if (typeof callback === 'function') callback({ success: true, bans: bans || [] });
      } catch (err) {
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    });

    // ─── RPC: Consulta de Veículos da Garagem do Cidadão ─────────
    serverSocket.on('get_player_vehicles', async (data, callback) => {
      const citizenid = String(data?.citizenid || '').trim();
      if (!citizenid) {
        if (typeof callback === 'function') callback({ success: false, error: 'CitizenID não fornecido.', vehicles: [] });
        return;
      }

      try {
        let rows = [];
        if (exports?.oxmysql?.query_async) {
          rows = await exports.oxmysql.query_async(
            `SELECT id, citizenid, plate, fakeplate, vehicle, vehicle_name, garage, state, 
                    depotprice, fuel, engine, body, mods, trunk, glovebox 
             FROM player_vehicles 
             WHERE citizenid = ? 
             ORDER BY id DESC`,
            [citizenid]
          );
        }

        if (!rows || rows.length === 0) {
          if (typeof callback === 'function') callback({ success: true, vehicles: [] });
          return;
        }

        // Mapeamento de Entidades Vivas no OneSync (GetAllVehicles)
        const activeVehicles = typeof GetAllVehicles === 'function' ? GetAllVehicles() : [];
        const activePlateMap = new Map();

        for (const veh of activeVehicles) {
          if (DoesEntityExist(veh)) {
            const rawPlate = GetVehicleNumberPlateText(veh) || '';
            const cleanPlate = rawPlate.trim().toUpperCase().replace(/\s+/g, '');
            if (cleanPlate) {
              activePlateMap.set(cleanPlate, veh);
            }
          }
        }

        const vehicles = rows.map((row) => {
          const rawPlate = String(row.plate || '').trim().toUpperCase();
          const cleanPlate = rawPlate.replace(/\s+/g, '');
          const liveVeh = activePlateMap.get(cleanPlate);
          const isSpawned = Boolean(liveVeh && DoesEntityExist(liveVeh));

          let liveData = null;
          if (isSpawned) {
            try {
              const coords = GetEntityCoords(liveVeh);
              const engineHealth = Math.round(GetVehicleEngineHealth(liveVeh));
              liveData = {
                netId: NetworkGetNetworkIdFromEntity(liveVeh),
                x: coords[0] || coords.x,
                y: coords[1] || coords.y,
                z: coords[2] || coords.z,
                engineHealth: engineHealth,
                enginePercent: Math.max(0, Math.min(100, Math.round(engineHealth / 10))),
              };
            } catch (_e) {}
          }

          let trunkCount = 0;
          let gloveCount = 0;
          try {
            if (row.trunk) {
              const t = typeof row.trunk === 'string' ? JSON.parse(row.trunk) : row.trunk;
              trunkCount = Array.isArray(t) ? t.length : Object.keys(t).length;
            }
          } catch (_e) {}
          try {
            if (row.glovebox) {
              const g = typeof row.glovebox === 'string' ? JSON.parse(row.glovebox) : row.glovebox;
              gloveCount = Array.isArray(g) ? g.length : Object.keys(g).length;
            }
          } catch (_e) {}

          let displayName = row.vehicle_name;
          if (!displayName || displayName === 'NULL') {
            if (exports?.vanguard_garage?.GetVehicleDisplayName) {
              try { displayName = exports.vanguard_garage.GetVehicleDisplayName(row.vehicle, row.vehicle); } catch (_e) {}
            }
          }
          if (!displayName || displayName === 'NULL') {
            displayName = row.vehicle ? (row.vehicle.charAt(0).toUpperCase() + row.vehicle.slice(1)) : 'Veículo';
          }

          return {
            id: row.id,
            plate: rawPlate,
            fakeplate: row.fakeplate || null,
            model: row.vehicle,
            displayName: displayName,
            garage: row.garage || 'Garagem',
            state: Number(row.state) !== undefined ? Number(row.state) : 1, // 0: na rua, 1: guardado, 2: apreendido, 3: destruido
            depotPrice: Number(row.depotprice) || 0,
            fuel: Number(row.fuel) || 100,
            engine: Math.round(Number(row.engine) || 1000),
            body: Math.round(Number(row.body) || 1000),
            isSpawned: isSpawned,
            liveData: liveData,
            trunkCount: trunkCount,
            gloveCount: gloveCount,
          };
        });

        if (typeof callback === 'function') {
          callback({ success: true, vehicles });
        }
      } catch (err) {
        console.error(`[vanguard_dashboard] Erro ao buscar veículos de CID ${citizenid}:`, err.message);
        if (typeof callback === 'function') callback({ success: false, error: err.message, vehicles: [] });
      }
    });

    // ─── RPC: Consulta de Empregos e Facções do Servidor (QBX Core) ──
    serverSocket.on('get_jobs_and_gangs', (data, callback) => {
      try {
        const jobs = {};
        const gangs = {};

        if (exports?.qbx_core?.GetJobs) {
          const rawJobs = exports.qbx_core.GetJobs() || {};
          for (const [key, val] of Object.entries(rawJobs)) {
            const grades = {};
            if (val?.grades) {
              for (const [gLvl, gInfo] of Object.entries(val.grades)) {
                grades[Number(gLvl)] = {
                  name: gInfo?.name || `Grau ${gLvl}`,
                  payment: gInfo?.payment || 0,
                  isboss: Boolean(gInfo?.isboss),
                };
              }
            }
            jobs[key] = {
              name: key,
              label: val?.label || key,
              type: val?.type || null,
              grades,
            };
          }
        }

        if (exports?.qbx_core?.GetGangs) {
          const rawGangs = exports.qbx_core.GetGangs() || {};
          for (const [key, val] of Object.entries(rawGangs)) {
            const grades = {};
            if (val?.grades) {
              for (const [gLvl, gInfo] of Object.entries(val.grades)) {
                grades[Number(gLvl)] = {
                  name: gInfo?.name || `Grau ${gLvl}`,
                  isboss: Boolean(gInfo?.isboss),
                };
              }
            }
            gangs[key] = {
              name: key,
              label: val?.label || key,
              grades,
            };
          }
        }

        if (typeof callback === 'function') {
          callback({ success: true, jobs, gangs });
        }
      } catch (err) {
        if (typeof callback === 'function') {
          callback({ success: false, error: err.message, jobs: {}, gangs: {} });
        }
      }
    });

  } catch (err) {
    console.error('[vanguard_dashboard] Erro ao inicializar socket server:', err.message);
  }
}

// ─── Execução de Ações Administrativas Remotas (Central Total) ──
async function executeAdminAction(action, targetId, options, adminName) {
  let resolvedTargetId = Number(targetId) || 0;

  // Resolução inteligente: se targetId for 0 ou offline, checa se o jogador está online pelo citizenid
  if ((!resolvedTargetId || resolvedTargetId <= 0) && options?.citizenid && exports?.qbx_core?.GetPlayerByCitizenId) {
    try {
      const qp = exports.qbx_core.GetPlayerByCitizenId(options.citizenid);
      if (qp?.PlayerData?.source) {
        resolvedTargetId = Number(qp.PlayerData.source);
      }
    } catch (_e) {}
  }

  const idStr = String(resolvedTargetId);
  const isConnected = resolvedTargetId > 0 && Boolean(GetPlayerName(idStr));
  const ped = isConnected ? (GetPlayerPed(idStr) || 0) : null;

  // Ações globais ou offline não requerem entidade ped
  const globalActions = ['broadcast', 'set_weather', 'set_time', 'revoke_ban', 'get_server_bans', 'restart_resource'];
  const isGlobal = globalActions.includes(action);
  const isOffline = Boolean(options.isOffline || !isConnected);
  const offlineSupportedActions = [
    'ban', 'warn', 'manage_money', 'give_item', 'remove_item',
    'strip_weapons', 'clear_inventory', 'impound_vehicle', 'repair_vehicle', 'delete_vehicle',
    'jail', 'unjail', 'reduce_jail', 'set_jail_time',
    'set_job', 'set_gang', 'store_player_vehicle', 'spawn_player_vehicle', 'release_player_vehicle', 'impound_player_vehicle'
  ];

  if (!isGlobal) {
    if (isOffline && !offlineSupportedActions.includes(action)) {
      return { success: false, error: `Ação '${action}' requer que o jogador esteja online no servidor.` };
    }
    if (!isOffline && !isConnected) {
      return { success: false, error: `Jogador #${resolvedTargetId || targetId} não foi encontrado online no servidor.` };
    }
  }

  try {
    switch (action) {
      // 0. Reiniciar / Atualizar Recurso no FXServer
      case 'restart_resource': {
        const resName = options?.resource || 'vanguard_dashboard';
        if (typeof ExecuteCommand === 'function') {
          ExecuteCommand(`ensure ${resName}`);
          return { success: true, message: `Recurso '${resName}' recarregado com sucesso no FiveM.` };
        }
        return { success: false, error: 'ExecuteCommand não disponível no ambiente FiveM.' };
      }

      // 1. Freeze / Unfreeze
      case 'freeze': {
        const destId = resolvedTargetId || targetId;
        const shouldFreeze = options.toggle !== undefined ? Boolean(options.toggle) : !frozenPlayers.has(destId);
        if (typeof FreezeEntityPosition === 'function') {
          try { FreezeEntityPosition(ped, shouldFreeze); } catch (_e) {}
        }
        emitNet('vanguard_dashboard:client:freeze', destId, shouldFreeze);

        if (shouldFreeze) {
          frozenPlayers.add(destId);
        } else {
          frozenPlayers.delete(destId);
        }

        sendTelemetryNow();

        try {
          emitNet('ox_lib:notify', destId, {
            title: 'Administração',
            description: shouldFreeze ? 'Você foi congelado por um administrador.' : 'Você foi descongelado.',
            type: shouldFreeze ? 'warning' : 'inform',
            duration: 5000,
          });
        } catch (_e) {}

        return {
          success: true,
          message: shouldFreeze ? `Jogador #${destId} congelado com sucesso.` : `Jogador #${destId} descongelado com sucesso.`,
          isFrozen: shouldFreeze,
        };
      }

      // 2. Reviver
      case 'revive': {
        emitNet('vanguard_dashboard:client:revive', targetId);
        emitNet('hospital:client:Revive', targetId);
        emitNet('qbx_medical:client:revive', targetId);
        emitNet('QBCore:Client:Revive', targetId);
        emitNet('ars_ambulancejob:healPlayer', targetId, { revive: true });

        try {
          if (exports?.qbx_core?.GetPlayer) {
            const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
            if (qbxPlayer?.Functions?.SetMetaData) {
              qbxPlayer.Functions.SetMetaData('hunger', 100);
              qbxPlayer.Functions.SetMetaData('thirst', 100);
              qbxPlayer.Functions.SetMetaData('stress', 0);
            }
          }
        } catch (_e) {}

        try {
          if (exports?.dp_obito?.ForceClearDeath) {
            exports.dp_obito.ForceClearDeath(targetId);
          }
        } catch (_e) {}

        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Administração',
            description: `Você foi revivido e curado por ${adminName}.`,
            type: 'success',
            duration: 6000,
          });
        } catch (_e) {}

        return { success: true, message: `Jogador #${targetId} revivido com sucesso.` };
      }

      // 3. Curar (Heal)
      case 'heal': {
        emitNet('vanguard_dashboard:client:heal', targetId);

        try {
          if (exports?.qbx_core?.GetPlayer) {
            const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
            if (qbxPlayer?.Functions?.SetMetaData) {
              qbxPlayer.Functions.SetMetaData('hunger', 100);
              qbxPlayer.Functions.SetMetaData('thirst', 100);
            }
          }
        } catch (_e) {}

        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Administração',
            description: `Você foi curado por ${adminName}.`,
            type: 'success',
            duration: 5000,
          });
        } catch (_e) {}

        return { success: true, message: `Jogador #${targetId} curado (HP 200, AR 100).` };
      }

      // 4. Teletransporte (Teleport para Coordenadas)
      case 'teleport': {
        const coords = options.coords;
        if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number' || typeof coords.z !== 'number') {
          return { success: false, error: 'Coordenadas de destino inválidas.' };
        }

        if (typeof SetEntityCoords === 'function') {
          try { SetEntityCoords(ped, coords.x, coords.y, coords.z, false, false, false, false); } catch (_e) {}
        }
        emitNet('vanguard_dashboard:client:teleport', targetId, coords);

        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Administração',
            description: `Você foi teletransportado por ${adminName}.`,
            type: 'inform',
            duration: 5000,
          });
        } catch (_e) {}

        return {
          success: true,
          message: `Jogador #${targetId} teletransportado para [${coords.x.toFixed(1)}, ${coords.y.toFixed(1)}, ${coords.z.toFixed(1)}].`,
        };
      }

      // 5. Puxar Jogador (Bring)
      case 'bring': {
        const dest = options.coords || { x: 215.7, y: -810.0, z: 30.7 }; // Sala Staff padrão
        if (typeof SetEntityCoords === 'function') {
          try { SetEntityCoords(ped, dest.x, dest.y, dest.z, false, false, false, false); } catch (_e) {}
        }
        emitNet('vanguard_dashboard:client:teleport', targetId, dest);

        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Administração',
            description: `Você foi puxado para a sala de atendimento por ${adminName}.`,
            type: 'warning',
            duration: 8000,
          });
        } catch (_e) {}

        return { success: true, message: `Jogador #${targetId} puxado com sucesso.` };
      }

      // 6. Mensagem de Alerta / Aviso (Warn)
      case 'warn': {
        const msg = String(options.message || '').trim();
        if (!msg) {
          return { success: false, error: 'Mensagem de aviso não pode estar vazia.' };
        }

        let license = options.license || null;
        if (ped) {
          try {
            emitNet('ox_lib:notify', targetId, {
              title: '⚠️ AVISO DA ADMINISTRAÇÃO',
              description: msg,
              type: 'error',
              duration: 15000,
            });
            emitNet('chat:addMessage', targetId, {
              color: [255, 50, 50],
              multiline: true,
              args: ['[ADMINISTRAÇÃO]', msg],
            });
          } catch (_e) {}

          const numIds = GetNumPlayerIdentifiers(idStr);
          for (let i = 0; i < numIds; i++) {
            const ident = GetPlayerIdentifier(idStr, i);
            if (ident && ident.startsWith('license:')) { license = ident; break; }
          }
        } else if (options.citizenid && exports?.oxmysql?.query_async) {
          try {
            const rows = await exports.oxmysql.query_async(
              'SELECT license FROM players WHERE citizenid = ? LIMIT 1',
              [options.citizenid]
            );
            if (rows && rows[0]) license = rows[0].license;
          } catch (_e) {}
        }

        if (license && exports?.oxmysql?.insert_async) {
          await exports.oxmysql.insert_async(
            'INSERT INTO player_warns (senderIdentifier, targetIdentifier, reason, warnId, createdAt) VALUES (?, ?, ?, UUID(), NOW())',
            [adminName, license, msg]
          );
          return { success: true, message: `Advertência registrada com sucesso para ${license}.` };
        }

        return { success: ped ? true : false, message: ped ? `Aviso enviado para #${targetId}.` : 'Licença não encontrada para gravar aviso.' };
      }

      // 7. Expulsão (Kick)
      case 'kick': {
        if (!ped) return { success: false, error: 'Jogador offline não pode ser expulso (kick).' };
        const reason = String(options.reason || 'Expulso pela administração do servidor.').trim();
        DropPlayer(idStr, `[Vanguard Moderation] ${reason} (Por: ${adminName})`);
        return { success: true, message: `Jogador #${targetId} expulso com sucesso.` };
      }

      // 8. Banimento Persistente (Tabela bans via oxmysql / qbx_core)
      case 'ban': {
        const reason = String(options.reason || 'Banido pela administração.').trim();
        const isPermanent = Boolean(options.isPermanent);
        const durationMinutes = options.durationMinutes ? parseInt(options.durationMinutes) : 0;
        const expire = (isPermanent || durationMinutes <= 0) ? 2147483647 : Math.floor(Date.now() / 1000) + (durationMinutes * 60);

        let name = options.name || (ped ? GetPlayerName(idStr) : `Cidadão ${options.citizenid || ''}`);
        let license = options.license || null;
        let discord = options.discord || null;
        let ip = null;

        if (ped) {
          const numIds = GetNumPlayerIdentifiers(idStr);
          for (let i = 0; i < numIds; i++) {
            const ident = GetPlayerIdentifier(idStr, i);
            if (!ident) continue;
            if (ident.startsWith('license:')) license = ident;
            else if (ident.startsWith('discord:')) discord = ident;
            else if (ident.startsWith('ip:')) ip = ident.replace('ip:', '');
          }
          DropPlayer(idStr, `[Vanguard Ban] ${reason} (Por: ${adminName})`);
        } else if (options.citizenid && exports?.oxmysql?.query_async) {
          try {
            const rows = await exports.oxmysql.query_async(
              'SELECT name, license FROM players WHERE citizenid = ? LIMIT 1',
              [options.citizenid]
            );
            if (rows && rows[0]) {
              name = rows[0].name || name;
              license = rows[0].license || license;
            }
          } catch (_e) {}
        }

        if (!license && options.identifier) license = options.identifier;
        if (!license) license = `license:unknown_${options.citizenid || targetId}`;

        if (exports?.oxmysql?.insert_async) {
          await exports.oxmysql.insert_async(
            'INSERT INTO bans (name, license, discord, ip, reason, expire, bannedby) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, license, discord, ip, reason, expire, adminName]
          );
          return {
            success: true,
            message: `Banimento aplicado com sucesso para ${name}. Expiração: ${isPermanent ? 'Permanente' : new Date(expire * 1000).toLocaleString('pt-BR')}`,
          };
        }
        return { success: false, error: 'oxmysql indisponível para aplicar banimento.' };
      }

      // 9. Revogar Banimento (Unban)
      case 'revoke_ban': {
        const identifier = String(options.identifier || '').trim();
        if (!identifier) return { success: false, error: 'Identificador do ban não informado.' };

        try {
          if (exports?.oxmysql?.execute_async) {
            await exports.oxmysql.execute_async(
              'DELETE FROM bans WHERE id = ? OR license = ? OR discord = ?',
              [identifier, identifier, identifier]
            );
            return { success: true, message: `Punição revogada com sucesso para: ${identifier}` };
          }
        } catch (err) {
          return { success: false, error: `Falha ao remover ban: ${err.message}` };
        }
        return { success: false, error: 'oxmysql indisponível.' };
      }

      // 10. Dar Item (ox_inventory AddItem ou MySQL players.inventory)
      case 'give_item': {
        const item = String(options.item || '').trim();
        const count = Math.max(1, parseInt(options.count) || 1);
        if (!item) return { success: false, error: 'Nome do item não informado.' };

        // A) Jogador Online
        if (ped && exports?.ox_inventory?.AddItem) {
          const ok = exports.ox_inventory.AddItem(targetId, item, count, options.metadata || null);
          if (ok) {
            try {
              emitNet('ox_lib:notify', targetId, {
                title: 'Administração',
                description: `Você recebeu ${count}x ${item} da equipe staff.`,
                type: 'success',
                duration: 5000,
              });
            } catch (_e) {}
            return { success: true, message: `${count}x '${item}' adicionado ao inventário de #${targetId} (Online).` };
          } else {
            return { success: false, error: 'Falha ao adicionar item (capacidade excedida ou item inexistente no ox).' };
          }
        }

        // B) Jogador Offline (Gravação direta no JSON do banco)
        if (options.citizenid && exports?.oxmysql?.query_async && exports?.oxmysql?.execute_async) {
          try {
            const rows = await exports.oxmysql.query_async('SELECT inventory FROM players WHERE citizenid = ? LIMIT 1', [options.citizenid]);
            if (rows && rows[0]) {
              let inv = typeof rows[0].inventory === 'string' ? JSON.parse(rows[0].inventory) : (rows[0].inventory || []);
              if (!Array.isArray(inv)) inv = Object.values(inv || {});

              let maxSlot = 0;
              inv.forEach((it) => { if (it.slot > maxSlot) maxSlot = it.slot; });

              inv.push({
                name: item,
                count: count,
                slot: maxSlot + 1,
                metadata: options.metadata || {},
              });

              await exports.oxmysql.execute_async('UPDATE players SET inventory = ? WHERE citizenid = ?', [JSON.stringify(inv), options.citizenid]);
              return { success: true, message: `${count}x '${item}' adicionado ao inventário offline de CID:${options.citizenid}.` };
            }
          } catch (err) {
            return { success: false, error: `Falha ao inserir item offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline ou ox_inventory indisponível.' };
      }

      // 11. Remover Item (ox_inventory RemoveItem ou MySQL players.inventory)
      case 'remove_item': {
        const item = String(options.item || '').trim();
        const count = Math.max(1, parseInt(options.count) || 1);
        const slot = options.slot ? parseInt(options.slot) : null;
        if (!item) return { success: false, error: 'Nome do item não informado.' };

        // A) Jogador Online
        if (ped && exports?.ox_inventory?.RemoveItem) {
          const ok = exports.ox_inventory.RemoveItem(targetId, item, count, null, slot);
          if (ok) {
            try {
              emitNet('ox_lib:notify', targetId, {
                title: 'Administração',
                description: `${count}x ${item} foi confiscado do seu inventário pela staff.`,
                type: 'warning',
                duration: 5000,
              });
            } catch (_e) {}
            return { success: true, message: `${count}x '${item}' removido do jogador #${targetId} (Online).` };
          } else {
            return { success: false, error: 'Falha ao remover item (quantidade insuficiente no ox).' };
          }
        }

        // B) Jogador Offline
        if (options.citizenid && exports?.oxmysql?.query_async && exports?.oxmysql?.execute_async) {
          try {
            const rows = await exports.oxmysql.query_async('SELECT inventory FROM players WHERE citizenid = ? LIMIT 1', [options.citizenid]);
            if (rows && rows[0]) {
              let inv = typeof rows[0].inventory === 'string' ? JSON.parse(rows[0].inventory) : (rows[0].inventory || []);
              if (!Array.isArray(inv)) inv = Object.values(inv || {});

              let found = false;
              inv = inv.filter((it) => {
                if (it.name === item || (slot && it.slot === slot)) {
                  found = true;
                  if (it.count > count) {
                    it.count -= count;
                    return true;
                  }
                  return false;
                }
                return true;
              });

              if (!found) return { success: false, error: `Item '${item}' não encontrado no inventário offline.` };

              await exports.oxmysql.execute_async('UPDATE players SET inventory = ? WHERE citizenid = ?', [JSON.stringify(inv), options.citizenid]);
              return { success: true, message: `${count}x '${item}' removido do inventário offline de CID:${options.citizenid}.` };
            }
          } catch (err) {
            return { success: false, error: `Falha ao remover item offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline ou ox_inventory indisponível.' };
      }

      // 12. Desarmar Jogador (Strip Weapons)
      case 'strip_weapons': {
        // A) Jogador Online
        if (ped && exports?.ox_inventory?.GetInventory && exports?.ox_inventory?.RemoveItem) {
          const inv = exports.ox_inventory.GetInventory(targetId);
          if (!inv || !inv.items) return { success: false, error: 'Inventário vazio ou inacessível.' };

          let countRemoved = 0;
          for (const key of Object.keys(inv.items)) {
            const it = inv.items[key];
            if (!it || !it.name) continue;
            const upper = it.name.toUpperCase();
            if (upper.startsWith('WEAPON_') || it.name.toLowerCase().includes('ammo')) {
              exports.ox_inventory.RemoveItem(targetId, it.name, it.count || 1, null, it.slot);
              countRemoved++;
            }
          }

          try {
            emitNet('ox_lib:notify', targetId, {
              title: 'Administração',
              description: 'Todas as suas armas e munições foram desarmadas pela moderação.',
              type: 'error',
              duration: 8000,
            });
          } catch (_e) {}

          return { success: true, message: `Jogador #${targetId} desarmado. ${countRemoved} itens confiscados (Online).` };
        }

        // B) Jogador Offline
        if (options.citizenid && exports?.oxmysql?.query_async && exports?.oxmysql?.execute_async) {
          try {
            const rows = await exports.oxmysql.query_async('SELECT inventory FROM players WHERE citizenid = ? LIMIT 1', [options.citizenid]);
            if (rows && rows[0]) {
              let inv = typeof rows[0].inventory === 'string' ? JSON.parse(rows[0].inventory) : (rows[0].inventory || []);
              if (!Array.isArray(inv)) inv = Object.values(inv || {});

              const beforeCount = inv.length;
              inv = inv.filter((it) => {
                if (!it || !it.name) return true;
                const upper = it.name.toUpperCase();
                return !(upper.startsWith('WEAPON_') || it.name.toLowerCase().includes('ammo'));
              });

              const removed = beforeCount - inv.length;
              await exports.oxmysql.execute_async('UPDATE players SET inventory = ? WHERE citizenid = ?', [JSON.stringify(inv), options.citizenid]);
              return { success: true, message: `${removed} itens bélicos removidos do inventário offline de CID:${options.citizenid}.` };
            }
          } catch (err) {
            return { success: false, error: `Falha ao desarmar offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline ou ox_inventory indisponível.' };
      }

      // 13. Limpar Todo o Inventário (Wipe)
      case 'clear_inventory': {
        // A) Jogador Online
        if (ped && exports?.ox_inventory?.ClearInventory) {
          exports.ox_inventory.ClearInventory(targetId);
          try {
            emitNet('ox_lib:notify', targetId, {
              title: 'Administração',
              description: 'Seu inventário foi esvaziado pela equipe de moderação.',
              type: 'error',
              duration: 8000,
            });
          } catch (_e) {}
          return { success: true, message: `Inventário de #${targetId} totalmente limpo (Online).` };
        }

        // B) Jogador Offline
        if (options.citizenid && exports?.oxmysql?.execute_async) {
          try {
            await exports.oxmysql.execute_async('UPDATE players SET inventory = ? WHERE citizenid = ?', ['[]', options.citizenid]);
            return { success: true, message: `Inventário offline de CID:${options.citizenid} limpo com sucesso.` };
          } catch (err) {
            return { success: false, error: `Falha ao limpar inventário offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline ou ox_inventory indisponível.' };
      }

      // 14. Gestão Financeira (QBX Core Money / MySQL players.money)
      case 'manage_money': {
        let account = String(options.account || 'bank').toLowerCase();
        if (account === 'gemas' || account === 'gems') account = 'gems';
        const operation = String(options.operation || 'add').toLowerCase();
        const amount = Math.abs(parseInt(options.amount) || 0);

        if (!['cash', 'bank', 'crypto', 'gems'].includes(account)) {
          return { success: false, error: 'Conta financeira inválida (cash, bank, crypto, gems).' };
        }
        if (amount <= 0 && operation !== 'set') {
          return { success: false, error: 'O valor deve ser maior que zero.' };
        }

        const accountLabel = account === 'gems' ? '💎 Gemas' : account.toUpperCase();

        // A) Jogador Online
        if (isConnected && targetId > 0 && exports?.qbx_core?.GetPlayer) {
          const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
          if (qbxPlayer && qbxPlayer.Functions) {
            const reason = `Dashboard Staff (${adminName})`;
            if (operation === 'add') qbxPlayer.Functions.AddMoney(account, amount, reason);
            else if (operation === 'remove') qbxPlayer.Functions.RemoveMoney(account, amount, reason);
            else if (operation === 'set') qbxPlayer.Functions.SetMoney(account, amount, reason);

            if (account === 'gems') {
              try {
                const currentGems = qbxPlayer.PlayerData?.money?.gems || amount;
                Player(idStr).state.set('gems', currentGems, true);
              } catch (_e) {}
            }

            return {
              success: true,
              message: `Saldo (${accountLabel}) de #${targetId} alterado: ${operation.toUpperCase()} ${amount.toLocaleString('pt-BR')} (Online).`,
            };
          }
        }

        // B) Jogador Offline (MySQL players.money)
        if (options.citizenid && exports?.oxmysql?.query_async && exports?.oxmysql?.execute_async) {
          try {
            const rows = await exports.oxmysql.query_async('SELECT money FROM players WHERE citizenid = ? LIMIT 1', [options.citizenid]);
            if (rows && rows[0]) {
              let moneyObj = typeof rows[0].money === 'string' ? JSON.parse(rows[0].money) : (rows[0].money || {});
              const currentVal = Number(moneyObj[account]) || 0;
              let newVal = currentVal;
              if (operation === 'add') newVal = currentVal + amount;
              else if (operation === 'remove') newVal = Math.max(0, currentVal - amount);
              else if (operation === 'set') newVal = amount;

              moneyObj[account] = newVal;
              await exports.oxmysql.execute_async('UPDATE players SET money = ? WHERE citizenid = ?', [JSON.stringify(moneyObj), options.citizenid]);
              return { success: true, message: `Saldo offline [${accountLabel}] de CID:${options.citizenid} alterado para ${newVal.toLocaleString('pt-BR')}.` };
            }
          } catch (err) {
            return { success: false, error: `Falha ao atualizar saldo offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline ou dados insuficientes para alterar saldo.' };
      }

      // 15. Reparar Veículo do Jogador (Online ou Banco)
      case 'repair_vehicle': {
        const plate = String(options.plate || '').trim().toUpperCase();
        const clean = plate.replace(/\s+/g, '');
        let liveRepaired = false;

        if (ped) {
          const veh = GetVehiclePedIsIn(ped, false);
          if (veh && veh !== 0) {
            SetVehicleEngineHealth(veh, 1000.0);
            SetVehicleBodyHealth(veh, 1000.0);
            SetVehicleFixed(veh);
            SetVehicleDirtLevel(veh, 0.0);
            const netId = NetworkGetNetworkIdFromEntity(veh);
            emitNet('vanguard_dashboard:client:repairVehicle', resolvedTargetId, netId);
            liveRepaired = true;
          }
        }

        // Repara qualquer entidade viva encontrada no OneSync com a placa
        if (clean) {
          const allVehs = typeof GetAllVehicles === 'function' ? GetAllVehicles() : [];
          for (const v of allVehs) {
            if (DoesEntityExist(v)) {
              const p = (GetVehicleNumberPlateText(v) || '').trim().toUpperCase().replace(/\s+/g, '');
              if (p === clean) {
                SetVehicleEngineHealth(v, 1000.0);
                SetVehicleBodyHealth(v, 1000.0);
                SetVehicleFixed(v);
                SetVehicleDirtLevel(v, 0.0);
                liveRepaired = true;
              }
            }
          }

          if (exports?.oxmysql?.execute_async) {
            try {
              await exports.oxmysql.execute_async(
                `UPDATE player_vehicles SET engine = 1000, body = 1000, deformation = NULL, status = NULL WHERE REPLACE(plate, ' ', '') = ?`,
                [clean]
              );
            } catch (_e) {}
          }
        }

        if (liveRepaired) {
          return { success: true, message: `Veículo [${plate || 'do jogador'}] reparado e limpo com 100% de integridade (Mundo & Banco de Dados).` };
        } else if (clean) {
          return { success: true, message: `Integridade do veículo [${plate}] restaurada para 100% no banco de dados.` };
        }

        return { success: false, error: 'Jogador não está em um veículo e placa não foi fornecida.' };
      }

      // 16. Deletar Veículo do Jogador
      case 'delete_vehicle': {
        if (ped) {
          const veh = GetVehiclePedIsIn(ped, false);
          if (veh && veh !== 0) {
            const netId = NetworkGetNetworkIdFromEntity(veh);
            if (typeof DeleteEntity === 'function') {
              try { DeleteEntity(veh); } catch (_e) {}
            }
            emitNet('vanguard_dashboard:client:deleteVehicle', targetId, netId);
            return { success: true, message: `Veículo de #${targetId} deletado da rua.` };
          }
        }
        return { success: true, message: 'Nenhum veículo ativo encontrado para exclusão imediata.' };
      }

      // 17. Apreender Veículo (Impound / Pátio - Online e Offline)
      case 'impound_vehicle': {
        const plate = String(options.plate || '').trim();
        const depotPrice = Math.max(0, parseInt(options.depotPrice) || 2500);
        if (!plate) return { success: false, error: 'Placa do veículo não informada.' };

        // Se o veículo estiver na rua perto do jogador, remove a entidade
        if (ped) {
          const veh = GetVehiclePedIsIn(ped, false);
          if (veh && veh !== 0) {
            const netId = NetworkGetNetworkIdFromEntity(veh);
            if (typeof DeleteEntity === 'function') {
              try { DeleteEntity(veh); } catch (_e) {}
            }
            emitNet('vanguard_dashboard:client:deleteVehicle', targetId, netId);
          }
        }

        // Atualiza banco de dados
        try {
          if (exports?.oxmysql?.execute_async) {
            await exports.oxmysql.execute_async(
              'UPDATE player_vehicles SET state = 2, depotprice = ? WHERE plate = ?',
              [depotPrice, plate]
            );
          }
        } catch (_e) {}

        return { success: true, message: `Veículo [${plate}] apreendido para o pátio (Taxa: R$ ${depotPrice}).` };
      }

      // 18. Silenciar Voz (Mute Mumble/pma-voice)
      case 'mute_voice': {
        const currentMuted = voiceMutedPlayers.has(targetId) || Boolean(Player(idStr)?.state?.muted);
        const shouldMute = options.toggle !== undefined ? Boolean(options.toggle) : !currentMuted;

        if (shouldMute) {
          voiceMutedPlayers.add(targetId);
        } else {
          voiceMutedPlayers.delete(targetId);
        }

        try {
          MumbleSetPlayerMuted(targetId, shouldMute);
          Player(idStr).state.muted = shouldMute;
          emit('pma-voice:playerMuted', targetId, 0, shouldMute, 0);
          emitNet('pma-voice:mutePlayer', targetId, shouldMute);
        } catch (_e) {}

        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Moderação de Voz',
            description: shouldMute ? 'Você foi silenciado por um administrador.' : 'Seu microfone foi reativado.',
            type: shouldMute ? 'error' : 'success',
            duration: 6000,
          });
        } catch (_e) {}

        return {
          success: true,
          message: shouldMute ? `Voz de #${targetId} silenciada.` : `Voz de #${targetId} reativada.`,
          isMuted: shouldMute,
        };
      }

      // 19. Silenciar Chat (mri_Qchat statebag)
      case 'mute_chat': {
        const currentMuted = chatMutedPlayers.has(targetId) || Boolean(Player(idStr)?.state?.chatMuted);
        const shouldMute = options.toggle !== undefined ? Boolean(options.toggle) : !currentMuted;

        if (shouldMute) {
          chatMutedPlayers.add(targetId);
        } else {
          chatMutedPlayers.delete(targetId);
        }

        try {
          Player(idStr).state.chatMuted = shouldMute;
        } catch (_e) {}

        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Moderação de Chat',
            description: shouldMute ? 'Você foi silenciado no chat de texto.' : 'Seu chat foi liberado.',
            type: shouldMute ? 'error' : 'success',
            duration: 6000,
          });
        } catch (_e) {}

        return {
          success: true,
          message: shouldMute ? `Chat de #${targetId} bloqueado.` : `Chat de #${targetId} liberado.`,
          isMuted: shouldMute,
        };
      }

      // 20. Prisão Administrativa (pickle_prisons / qbx_core / MySQL)
      case 'jail': {
        const timeMinutes = Math.max(1, parseInt(options.time) || 10);
        const prisonName = options.prison || 'default';

        // A) Jogador Online
        if (isConnected && targetId > 0) {
          let jailed = false;
          if (exports?.pickle_prisons?.JailPlayer) {
            exports.pickle_prisons.JailPlayer(targetId, timeMinutes, prisonName, false);
            jailed = true;
          }
          if (exports?.qbx_core?.GetPlayer) {
            const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
            if (qbxPlayer?.Functions?.SetMetaData) {
              qbxPlayer.Functions.SetMetaData('injail', timeMinutes);
              jailed = true;
            }
          }
          if (jailed) {
            try {
              emitNet('ox_lib:notify', targetId, {
                title: 'Sentença Judicial / Prisão',
                description: `Você foi sentenciado a ${timeMinutes} minutos de prisão por ${adminName}.`,
                type: 'error',
                duration: 10000,
              });
            } catch (_e) {}
            return { success: true, message: `Jogador #${targetId} sentenciado a ${timeMinutes} minutos de prisão (Online).` };
          }
        }

        // B) Jogador Offline (MySQL pickle_prisons + players metadata)
        if (options.citizenid && exports?.oxmysql?.execute_async) {
          try {
            const timeSeconds = timeMinutes * 60;
            await exports.oxmysql.execute_async(
              'DELETE FROM pickle_prisons WHERE identifier = ?',
              [options.citizenid]
            );
            await exports.oxmysql.execute_async(
              'INSERT INTO pickle_prisons (identifier, prison, time, inventory, sentence_date) VALUES (?, ?, ?, ?, UNIX_TIMESTAMP())',
              [options.citizenid, prisonName, timeSeconds, '[]']
            );

            if (exports?.oxmysql?.query_async) {
              const rows = await exports.oxmysql.query_async(
                'SELECT metadata FROM players WHERE citizenid = ? LIMIT 1',
                [options.citizenid]
              );
              if (rows && rows[0]) {
                let meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : (rows[0].metadata || {});
                meta.injail = timeMinutes;
                await exports.oxmysql.execute_async(
                  'UPDATE players SET metadata = ? WHERE citizenid = ?',
                  [JSON.stringify(meta), options.citizenid]
                );
              }
            }

            return {
              success: true,
              message: `Cidadão CID:${options.citizenid} sentenciado a ${timeMinutes} minutos na prisão (Persistido no Banco de Dados).`,
            };
          } catch (err) {
            return { success: false, error: `Falha ao registrar prisão offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline e citizenid não informado.' };
      }

      // 21. Libertar da Prisão (Unjail)
      case 'unjail': {
        // A) Jogador Online
        if (isConnected && targetId > 0) {
          let unjailed = false;
          if (exports?.pickle_prisons?.UnjailPlayer) {
            exports.pickle_prisons.UnjailPlayer(targetId);
            unjailed = true;
          }
          if (exports?.qbx_core?.GetPlayer) {
            const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
            if (qbxPlayer?.Functions?.SetMetaData) {
              qbxPlayer.Functions.SetMetaData('injail', 0);
              unjailed = true;
            }
          }
          if (unjailed) {
            try {
              emitNet('ox_lib:notify', targetId, {
                title: 'Alvará de Soltura',
                description: `Você foi liberado da prisão pela administração (${adminName}).`,
                type: 'success',
                duration: 8000,
              });
            } catch (_e) {}
            return { success: true, message: `Jogador #${targetId} liberado da prisão com sucesso (Online).` };
          }
        }

        // B) Jogador Offline
        if (options.citizenid && exports?.oxmysql?.execute_async) {
          try {
            await exports.oxmysql.execute_async(
              'DELETE FROM pickle_prisons WHERE identifier = ?',
              [options.citizenid]
            );

            if (exports?.oxmysql?.query_async) {
              const rows = await exports.oxmysql.query_async(
                'SELECT metadata FROM players WHERE citizenid = ? LIMIT 1',
                [options.citizenid]
              );
              if (rows && rows[0]) {
                let meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : (rows[0].metadata || {});
                meta.injail = 0;
                await exports.oxmysql.execute_async(
                  'UPDATE players SET metadata = ? WHERE citizenid = ?',
                  [JSON.stringify(meta), options.citizenid]
                );
              }
            }

            return { success: true, message: `Cidadão CID:${options.citizenid} liberado da prisão (Banco de Dados atualizado).` };
          } catch (err) {
            return { success: false, error: `Falha ao libertar jogador offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline e citizenid não informado.' };
      }

      // 22. Reduzir Pena de Prisão (pickle_prisons / MySQL)
      case 'reduce_jail': {
        const amountMinutes = Math.max(1, parseInt(options.amount) || 5);

        // A) Jogador Online
        if (isConnected && targetId > 0) {
          let reduced = false;
          let remainingMin = 0;

          if (exports?.pickle_prisons?.ReducePrisonTime) {
            try {
              exports.pickle_prisons.ReducePrisonTime(targetId, amountMinutes, false);
              reduced = true;
            } catch (_e) {}
          }

          if (exports?.pickle_prisons?.GetPrisoner) {
            try {
              const prisoner = exports.pickle_prisons.GetPrisoner(targetId);
              if (prisoner && prisoner.time) {
                remainingMin = Math.ceil((Number(prisoner.time) || 0) / 60);
              }
            } catch (_e) {}
          }

          if (exports?.qbx_core?.GetPlayer) {
            const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
            if (qbxPlayer?.Functions?.SetMetaData) {
              qbxPlayer.Functions.SetMetaData('injail', remainingMin);
            }
          }

          try {
            emitNet('ox_lib:notify', targetId, {
              title: 'Redução de Pena',
              description: remainingMin <= 0
                ? 'Sua pena foi reduzida a zero e você foi libertado pela administração.'
                : `Sua pena de prisão foi reduzida em ${amountMinutes} minutos. Restam ${remainingMin} min.`,
              type: remainingMin <= 0 ? 'success' : 'inform',
              duration: 8000,
            });
          } catch (_e) {}

          return {
            success: true,
            message: remainingMin <= 0
              ? `Pena de #${targetId} zerada (-${amountMinutes} min). Jogador libertado da prisão.`
              : `Pena de #${targetId} reduzida em ${amountMinutes} min. Tempo restante: ${remainingMin} min.`,
            remainingMinutes: remainingMin,
          };
        }

        // B) Jogador Offline (MySQL pickle_prisons)
        if (options.citizenid && exports?.oxmysql?.query_async && exports?.oxmysql?.execute_async) {
          try {
            const rows = await exports.oxmysql.query_async(
              'SELECT time, prison FROM pickle_prisons WHERE identifier = ? LIMIT 1',
              [options.citizenid]
            );

            if (!rows || !rows[0]) {
              return { success: false, error: `Cidadão CID:${options.citizenid} não possui registro ativo de prisão.` };
            }

            const currentSeconds = Number(rows[0].time) || 0;
            const newSeconds = Math.max(0, currentSeconds - (amountMinutes * 60));
            const remainingMin = Math.ceil(newSeconds / 60);

            if (newSeconds <= 0) {
              await exports.oxmysql.execute_async(
                'DELETE FROM pickle_prisons WHERE identifier = ?',
                [options.citizenid]
              );
            } else {
              await exports.oxmysql.execute_async(
                'UPDATE pickle_prisons SET time = ? WHERE identifier = ?',
                [newSeconds, options.citizenid]
              );
            }

            // Atualiza metadata no QBX
            const pRows = await exports.oxmysql.query_async(
              'SELECT metadata FROM players WHERE citizenid = ? LIMIT 1',
              [options.citizenid]
            );
            if (pRows && pRows[0]) {
              let meta = typeof pRows[0].metadata === 'string' ? JSON.parse(pRows[0].metadata) : (pRows[0].metadata || {});
              meta.injail = remainingMin;
              await exports.oxmysql.execute_async(
                'UPDATE players SET metadata = ? WHERE citizenid = ?',
                [JSON.stringify(meta), options.citizenid]
              );
            }

            return {
              success: true,
              message: remainingMin <= 0
                ? `Pena offline de CID:${options.citizenid} zerada (-${amountMinutes} min). Registro de prisão removido.`
                : `Pena offline de CID:${options.citizenid} reduzida em ${amountMinutes} min. Restam ${remainingMin} min.`,
              remainingMinutes: remainingMin,
            };
          } catch (err) {
            return { success: false, error: `Falha ao reduzir pena offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline e citizenid não informado.' };
      }

      // 23. Definir Tempo de Prisão (Set Jail Time)
      case 'set_jail_time': {
        const timeMinutes = Math.max(0, parseInt(options.time) || 0);

        if (timeMinutes === 0) {
          return await executeAdminAction('unjail', targetId, options, adminName);
        }

        // A) Jogador Online
        if (isConnected && targetId > 0) {
          if (exports?.pickle_prisons?.SetPrisonTime) {
            try {
              exports.pickle_prisons.SetPrisonTime(targetId, timeMinutes, false);
            } catch (_e) {}
          }

          if (exports?.qbx_core?.GetPlayer) {
            const qbxPlayer = exports.qbx_core.GetPlayer(targetId);
            if (qbxPlayer?.Functions?.SetMetaData) {
              qbxPlayer.Functions.SetMetaData('injail', timeMinutes);
            }
          }

          try {
            emitNet('ox_lib:notify', targetId, {
              title: 'Sentença Atualizada',
              description: `Sua pena foi redefinida para ${timeMinutes} minutos pela administração.`,
              type: 'warning',
              duration: 8000,
            });
          } catch (_e) {}

          return {
            success: true,
            message: `Tempo de prisão de #${targetId} definido para ${timeMinutes} minutos.`,
            remainingMinutes: timeMinutes,
          };
        }

        // B) Jogador Offline
        if (options.citizenid && exports?.oxmysql?.execute_async) {
          try {
            const timeSeconds = timeMinutes * 60;
            await exports.oxmysql.execute_async(
              'UPDATE pickle_prisons SET time = ? WHERE identifier = ?',
              [timeSeconds, options.citizenid]
            );

            if (exports?.oxmysql?.query_async) {
              const pRows = await exports.oxmysql.query_async(
                'SELECT metadata FROM players WHERE citizenid = ? LIMIT 1',
                [options.citizenid]
              );
              if (pRows && pRows[0]) {
                let meta = typeof pRows[0].metadata === 'string' ? JSON.parse(pRows[0].metadata) : (pRows[0].metadata || {});
                meta.injail = timeMinutes;
                await exports.oxmysql.execute_async(
                  'UPDATE players SET metadata = ? WHERE citizenid = ?',
                  [JSON.stringify(meta), options.citizenid]
                );
              }
            }

            return {
              success: true,
              message: `Tempo de prisão offline de CID:${options.citizenid} definido para ${timeMinutes} minutos.`,
              remainingMinutes: timeMinutes,
            };
          } catch (err) {
            return { success: false, error: `Falha ao definir tempo de prisão offline: ${err.message}` };
          }
        }

        return { success: false, error: 'Jogador offline e citizenid não informado.' };
      }

      // 22. Comunicado Global da Cidade (Broadcast)
      case 'broadcast': {
        const msg = String(options.message || '').trim();
        if (!msg) return { success: false, error: 'Mensagem de anúncio vazia.' };

        try {
          emitNet('ox_lib:notify', -1, {
            title: '📢 COMUNICADO DA ADMINISTRAÇÃO',
            description: msg,
            type: 'warning',
            duration: 15000,
          });
          emitNet('chat:addMessage', -1, {
            color: [255, 50, 50],
            multiline: true,
            args: ['[ADMINISTRAÇÃO]', msg],
          });
        } catch (_e) {}

        return { success: true, message: 'Comunicado global transmitido para todos os cidadãos.' };
      }

      // 23. Controle Climático (Renewed-Weathersync GlobalState)
      case 'set_weather': {
        const weatherType = String(options.weather || 'EXTRASUNNY').toUpperCase();
        GlobalState.weather = { weather: weatherType, time: 9999999999 };
        return { success: true, message: `Clima da cidade alterado para ${weatherType}.` };
      }

      // 24. Sincronização de Horário (GlobalState.currentTime)
      case 'set_time': {
        const hour = Math.max(0, Math.min(23, parseInt(options.hour) || 12));
        const minute = Math.max(0, Math.min(59, parseInt(options.minute) || 0));
        GlobalState.currentTime = { hour, minute };
        return {
          success: true,
          message: `Horário sincronizado para ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}.`,
        };
      }

      // 25. Guardar Veículo na Garagem / DV (OneSync + MySQL)
      case 'store_player_vehicle': {
        const plate = String(options.plate || '').trim().toUpperCase();
        if (!plate) return { success: false, error: 'Placa não informada.' };

        const clean = plate.replace(/\s+/g, '');
        const allVehs = typeof GetAllVehicles === 'function' ? GetAllVehicles() : [];
        let deleted = false;

        for (const v of allVehs) {
          if (DoesEntityExist(v)) {
            const p = (GetVehicleNumberPlateText(v) || '').trim().toUpperCase().replace(/\s+/g, '');
            if (p === clean) {
              DeleteEntity(v);
              deleted = true;
            }
          }
        }

        if (exports?.oxmysql?.execute_async) {
          await exports.oxmysql.execute_async(
            `UPDATE player_vehicles SET state = 1, coords = NULL WHERE REPLACE(plate, ' ', '') = ?`,
            [clean]
          );
        }

        return { 
          success: true, 
          message: `Veículo [${plate}] guardado na garagem com sucesso.${deleted ? ' Entidade removida da rua (DV).' : ''}` 
        };
      }

      // 26. Spawnar Veículo ao lado do Jogador Online
      case 'spawn_player_vehicle': {
        const plate = String(options.plate || '').trim().toUpperCase();
        const clean = plate.replace(/\s+/g, '');
        if (!ped || ped === 0) return { success: false, error: 'O cidadão precisa estar online para spawnar o veículo ao lado dele.' };

        let row = null;
        if (exports?.oxmysql?.query_async) {
          const rows = await exports.oxmysql.query_async(
            `SELECT vehicle, mods, fuel, citizenid FROM player_vehicles WHERE REPLACE(plate, ' ', '') = ? LIMIT 1`,
            [clean]
          );
          if (rows && rows[0]) row = rows[0];
        }
        if (!row) return { success: false, error: `Veículo com placa [${plate}] não encontrado no banco de dados.` };

        const modelHash = GetHashKey(row.vehicle);

        // Previne duplicação removendo entidade pré-existente
        const allVehs = typeof GetAllVehicles === 'function' ? GetAllVehicles() : [];
        for (const v of allVehs) {
          if (DoesEntityExist(v)) {
            const p = (GetVehicleNumberPlateText(v) || '').trim().toUpperCase().replace(/\s+/g, '');
            if (p === clean) DeleteEntity(v);
          }
        }

        // Posição com offset na frente/lado do ped
        const coords = GetEntityCoords(ped);
        const heading = GetEntityHeading(ped);
        const forwardX = coords[0] - Math.sin((heading * Math.PI) / 180) * 3.5;
        const forwardY = coords[1] + Math.cos((heading * Math.PI) / 180) * 3.5;

        const newVeh = CreateVehicle(modelHash, forwardX, forwardY, coords[2], heading, true, true);
        let timeout = 0;
        while (!DoesEntityExist(newVeh) && timeout < 50) {
          await new Promise((r) => setTimeout(r, 20));
          timeout++;
        }

        if (!newVeh || !DoesEntityExist(newVeh)) {
          return { success: false, error: 'Falha ao instanciar veículo no mapa via OneSync.' };
        }

        SetVehicleNumberPlateText(newVeh, plate);

        // Aplicação de mods salvos
        if (row.mods) {
          try {
            const parsedMods = typeof row.mods === 'string' ? JSON.parse(row.mods) : row.mods;
            if (parsedMods && Object.keys(parsedMods).length > 0) {
              emit('ox_lib:setVehicleProperties', newVeh, parsedMods);
            }
          } catch (_e) {}
        }

        // State Bags
        const stateBag = Entity(newVeh).state;
        if (stateBag) {
          stateBag.set('trackedPlate', plate, true);
          stateBag.set('fuel', Number(row.fuel) || 100, true);
          stateBag.set('owner', row.citizenid, true);
        }

        if (exports?.oxmysql?.execute_async) {
          await exports.oxmysql.execute_async(
            `UPDATE player_vehicles SET state = 0 WHERE REPLACE(plate, ' ', '') = ?`,
            [clean]
          );
        }

        return { success: true, message: `Veículo [${plate}] instanciado com sucesso ao lado do cidadão #${resolvedTargetId}.` };
      }

      // 27. Liberar Veículo do Pátio (Impound Release)
      case 'release_player_vehicle': {
        const plate = String(options.plate || '').trim().toUpperCase();
        const clean = plate.replace(/\s+/g, '');
        if (exports?.oxmysql?.execute_async) {
          await exports.oxmysql.execute_async(
            `UPDATE player_vehicles SET state = 1, depotprice = 0 WHERE REPLACE(plate, ' ', '') = ?`,
            [clean]
          );
          try {
            await exports.oxmysql.execute_async(
              `UPDATE police_impound SET paid = 1 WHERE REPLACE(plate, ' ', '') = ?`,
              [clean]
            );
          } catch (_e) {}
        }
        return { success: true, message: `Veículo [${plate}] liberado do pátio para a garagem com sucesso.` };
      }

      // 28. Apreender Veículo (Impound)
      case 'impound_player_vehicle': {
        const plate = String(options.plate || '').trim().toUpperCase();
        const clean = plate.replace(/\s+/g, '');
        const allVehs = typeof GetAllVehicles === 'function' ? GetAllVehicles() : [];
        for (const v of allVehs) {
          if (DoesEntityExist(v)) {
            const p = (GetVehicleNumberPlateText(v) || '').trim().toUpperCase().replace(/\s+/g, '');
            if (p === clean) DeleteEntity(v);
          }
        }
        if (exports?.oxmysql?.execute_async) {
          await exports.oxmysql.execute_async(
            `UPDATE player_vehicles SET state = 2, coords = NULL WHERE REPLACE(plate, ' ', '') = ?`,
            [clean]
          );
        }
        return { success: true, message: `Veículo [${plate}] apreendido no pátio com sucesso.` };
      }

      // 29. Definir Emprego (Set Job - Online & Offline)
      case 'set_job': {
        const rawJob = String(options.jobName || options.job || 'unemployed').trim().toLowerCase();
        const grade = Math.max(0, parseInt(options.grade) || 0);
        const citizenid = options.citizenid || (isConnected ? exports?.qbx_core?.GetPlayer(resolvedTargetId)?.PlayerData?.citizenid : null);

        if (!citizenid && !isConnected) {
          return { success: false, error: 'CitizenID não fornecido para definir emprego de jogador offline.' };
        }

        let jobData = null;
        if (exports?.qbx_core?.GetJob) {
          try { jobData = exports.qbx_core.GetJob(rawJob); } catch (_e) {}
        }

        const jobLabel = jobData?.label || rawJob;
        const gradeData = jobData?.grades ? jobData.grades[grade] : null;
        const gradeName = gradeData?.name || `Grau ${grade}`;

        // 1. Jogador Online
        if (isConnected && resolvedTargetId > 0) {
          let success = false;
          if (exports?.qbx_core?.SetJob) {
            try {
              success = exports.qbx_core.SetJob(resolvedTargetId, rawJob, grade);
            } catch (err) {
              console.error(`[vanguard_dashboard] Erro ao chamar qbx_core.SetJob para #${resolvedTargetId}:`, err.message);
            }
          }

          if (!success && exports?.qbx_core?.GetPlayer) {
            try {
              const qbxPlayer = exports.qbx_core.GetPlayer(resolvedTargetId);
              if (qbxPlayer?.Functions?.SetJob) {
                success = qbxPlayer.Functions.SetJob(rawJob, grade);
              }
            } catch (_e) {}
          }

          if (success) {
            try {
              emitNet('ox_lib:notify', resolvedTargetId, {
                title: 'Emprego Atualizado',
                description: `Seu emprego foi alterado para ${jobLabel} (${gradeName}) pela administração.`,
                type: 'success',
                duration: 7000,
              });
            } catch (_e) {}

            return {
              success: true,
              message: `Emprego de #${resolvedTargetId} alterado para '${jobLabel}' (${gradeName} - Grau ${grade}) (Online).`,
              job: { name: rawJob, label: jobLabel, gradeName, gradeLevel: grade },
            };
          }
        }

        // 2. Jogador Offline
        if (citizenid) {
          let qbxOfflineSuccess = false;
          if (exports?.qbx_core?.SetJob) {
            try {
              qbxOfflineSuccess = exports.qbx_core.SetJob(citizenid, rawJob, grade);
            } catch (err) {
              console.warn(`[vanguard_dashboard] exports.qbx_core.SetJob offline falhou para CID ${citizenid}:`, err.message);
            }
          }

          if (qbxOfflineSuccess) {
            return {
              success: true,
              message: `Emprego offline de CID:${citizenid} definido para '${jobLabel}' (${gradeName}) via qbx_core.`,
              job: { name: rawJob, label: jobLabel, gradeName, gradeLevel: grade },
            };
          }

          // Fallback defensivo no MySQL
          if (exports?.oxmysql?.execute_async && exports?.oxmysql?.query_async) {
            try {
              await exports.oxmysql.execute_async(
                'DELETE FROM player_groups WHERE citizenid = ? AND type = ?',
                [citizenid, 'job']
              );
              if (rawJob !== 'unemployed') {
                await exports.oxmysql.execute_async(
                  'INSERT INTO player_groups (citizenid, `group`, type, grade) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE grade = ?',
                  [citizenid, rawJob, 'job', grade, grade]
                );
              }

              const rows = await exports.oxmysql.query_async(
                'SELECT job FROM players WHERE citizenid = ? LIMIT 1',
                [citizenid]
              );
              if (rows && rows[0]) {
                const newJobObj = {
                  name: rawJob,
                  label: jobLabel,
                  payment: gradeData?.payment || 0,
                  onduty: Boolean(jobData?.defaultDuty),
                  isboss: Boolean(gradeData?.isboss),
                  bankAuth: Boolean(gradeData?.bankAuth),
                  type: jobData?.type || null,
                  grade: {
                    name: gradeName,
                    level: grade,
                  },
                };

                await exports.oxmysql.execute_async(
                  'UPDATE players SET job = ? WHERE citizenid = ?',
                  [JSON.stringify(newJobObj), citizenid]
                );

                return {
                  success: true,
                  message: `Emprego offline de CID:${citizenid} persistido como '${jobLabel}' (${gradeName}) no MySQL.`,
                  job: { name: rawJob, label: jobLabel, gradeName, gradeLevel: grade },
                };
              }
            } catch (err) {
              return { success: false, error: `Falha ao persistir emprego offline: ${err.message}` };
            }
          }
        }

        return { success: false, error: 'Falha ao alterar emprego: jogador não localizado.' };
      }

      // 30. Definir Organização / Facção (Set Gang - Online & Offline)
      case 'set_gang': {
        const rawGang = String(options.gangName || options.gang || 'none').trim().toLowerCase();
        const grade = Math.max(0, parseInt(options.grade) || 0);
        const citizenid = options.citizenid || (isConnected ? exports?.qbx_core?.GetPlayer(resolvedTargetId)?.PlayerData?.citizenid : null);

        if (!citizenid && !isConnected) {
          return { success: false, error: 'CitizenID não fornecido para definir facção de jogador offline.' };
        }

        let gangData = null;
        if (exports?.qbx_core?.GetGang) {
          try { gangData = exports.qbx_core.GetGang(rawGang); } catch (_e) {}
        }

        const gangLabel = gangData?.label || rawGang;
        const gradeData = gangData?.grades ? gangData.grades[grade] : null;
        const gradeName = gradeData?.name || `Grau ${grade}`;

        // 1. Jogador Online
        if (isConnected && resolvedTargetId > 0) {
          let success = false;
          if (exports?.qbx_core?.SetGang) {
            try {
              success = exports.qbx_core.SetGang(resolvedTargetId, rawGang, grade);
            } catch (err) {
              console.error(`[vanguard_dashboard] Erro ao chamar qbx_core.SetGang para #${resolvedTargetId}:`, err.message);
            }
          }

          if (!success && exports?.qbx_core?.GetPlayer) {
            try {
              const qbxPlayer = exports.qbx_core.GetPlayer(resolvedTargetId);
              if (qbxPlayer?.Functions?.SetGang) {
                success = qbxPlayer.Functions.SetGang(rawGang, grade);
              }
            } catch (_e) {}
          }

          if (success) {
            try {
              emitNet('ox_lib:notify', resolvedTargetId, {
                title: 'Organização Atualizada',
                description: `Seu envolvimento foi alterado para ${gangLabel} (${gradeName}) pela administração.`,
                type: 'warning',
                duration: 7000,
              });
            } catch (_e) {}

            return {
              success: true,
              message: `Facção de #${resolvedTargetId} alterada para '${gangLabel}' (${gradeName} - Grau ${grade}) (Online).`,
              gang: { name: rawGang, label: gangLabel, gradeName, gradeLevel: grade },
            };
          }
        }

        // 2. Jogador Offline
        if (citizenid) {
          let qbxOfflineSuccess = false;
          if (exports?.qbx_core?.SetGang) {
            try {
              qbxOfflineSuccess = exports.qbx_core.SetGang(citizenid, rawGang, grade);
            } catch (err) {
              console.warn(`[vanguard_dashboard] exports.qbx_core.SetGang offline falhou para CID ${citizenid}:`, err.message);
            }
          }

          if (qbxOfflineSuccess) {
            return {
              success: true,
              message: `Facção offline de CID:${citizenid} definida para '${gangLabel}' (${gradeName}) via qbx_core.`,
              gang: { name: rawGang, label: gangLabel, gradeName, gradeLevel: grade },
            };
          }

          // Fallback defensivo no MySQL
          if (exports?.oxmysql?.execute_async && exports?.oxmysql?.query_async) {
            try {
              await exports.oxmysql.execute_async(
                'DELETE FROM player_groups WHERE citizenid = ? AND type = ?',
                [citizenid, 'gang']
              );
              if (rawGang !== 'none') {
                await exports.oxmysql.execute_async(
                  'INSERT INTO player_groups (citizenid, `group`, type, grade) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE grade = ?',
                  [citizenid, rawGang, 'gang', grade, grade]
                );
              }

              const rows = await exports.oxmysql.query_async(
                'SELECT gang FROM players WHERE citizenid = ? LIMIT 1',
                [citizenid]
              );
              if (rows && rows[0]) {
                const newGangObj = {
                  name: rawGang,
                  label: gangLabel,
                  isboss: Boolean(gradeData?.isboss),
                  bankAuth: Boolean(gradeData?.bankAuth),
                  grade: {
                    name: gradeName,
                    level: grade,
                  },
                };

                await exports.oxmysql.execute_async(
                  'UPDATE players SET gang = ? WHERE citizenid = ?',
                  [JSON.stringify(newGangObj), citizenid]
                );

                return {
                  success: true,
                  message: `Facção offline de CID:${citizenid} persistida como '${gangLabel}' (${gradeName}) no MySQL.`,
                  gang: { name: rawGang, label: gangLabel, gradeName, gradeLevel: grade },
                };
              }
            } catch (err) {
              return { success: false, error: `Falha ao persistir facção offline: ${err.message}` };
            }
          }
        }

        return { success: false, error: 'Falha ao alterar facção: jogador não localizado.' };
      }

      default:
        return { success: false, error: `Ação desconhecida: ${action}` };
    }
  } catch (err) {
    return { success: false, error: `Falha ao executar ação: ${err.message}` };
  }
}

// ─── Extração de Inventário (ox_inventory) ─────────────────────
function getPlayerInventoryData(playerId) {
  let inv = null;
  if (exports?.ox_inventory?.GetInventory) {
    inv = exports.ox_inventory.GetInventory(playerId);
  }

  if (!inv) {
    return { items: [], weight: 0, maxWeight: 0, slots: 0 };
  }

  const rawItems = inv.items || [];
  const items = [];

  // Converte items (que pode ser tabela indexada por slot) em array legível
  for (const key of Object.keys(rawItems)) {
    const item = rawItems[key];
    if (!item || !item.name) continue;

    items.push({
      slot: item.slot ?? parseInt(key),
      name: item.name,
      label: item.label || item.name,
      count: item.count || 1,
      weight: item.weight || 0,
      durability: item.metadata?.durability ?? 100,
      serial: item.metadata?.serial || null,
      metadata: item.metadata || {},
    });
  }

  // Ordena por slot
  items.sort((a, b) => a.slot - b.slot);

  return {
    items,
    weight: inv.weight || 0,
    maxWeight: inv.maxWeight || 30000,
    slots: inv.slots || 50,
  };
}

/**
 * Consulta sob demanda de dossiê completo RP via QBX Core (Task 4)
 */
function getPlayerDossierData(playerId) {
  try {
    if (!exports?.qbx_core?.GetPlayer) return null;
    const qbxPlayer = exports.qbx_core.GetPlayer(playerId);
    if (!qbxPlayer?.PlayerData) return null;

    const pd = qbxPlayer.PlayerData;
    const char = pd.charinfo || {};
    const idStr = String(playerId);

    return {
      citizenid: pd.citizenid || 'N/A',
      cid: pd.cid ?? 1,
      license: pd.license || '',
      isVoiceMuted: voiceMutedPlayers.has(playerId) || Boolean(Player(idStr)?.state?.muted),
      isChatMuted: chatMutedPlayers.has(playerId) || Boolean(Player(idStr)?.state?.chatMuted),
      firstname: char.firstname || '',
      lastname: char.lastname || '',
      birthdate: char.birthdate || '',
      gender: char.gender === 0 ? 'M' : (char.gender === 1 ? 'F' : 'Outro'),
      phone: char.phone || 'Sem telefone',
      job: {
        name: pd.job?.name || 'unemployed',
        label: pd.job?.label || 'Desempregado',
        gradeName: pd.job?.grade?.name || 'Iniciante',
        gradeLevel: pd.job?.grade?.level ?? 0,
        onduty: Boolean(pd.job?.onduty),
      },
      gang: {
        name: pd.gang?.name || 'none',
        label: pd.gang?.label || 'Nenhuma',
        gradeName: pd.gang?.grade?.name || 'Membro',
      },
      money: {
        cash: pd.money?.cash || 0,
        bank: pd.money?.bank || 0,
        crypto: pd.money?.crypto || 0,
        gems: pd.money?.gems || 0,
      },
    };
  } catch (err) {
    console.error(`[vanguard_dashboard] Erro ao extrair dossiê para #${playerId}:`, err.message);
    return null;
  }
}

/**
 * Retorna a lista de IDs de jogadores conectados
 */
function getConnectedPlayerIds() {
  if (typeof getPlayers === 'function') {
    try {
      const p = getPlayers();
      if (Array.isArray(p)) return p;
    } catch (_e) {}
  }

  const list = [];
  try {
    const count = GetNumPlayerIndices();
    for (let i = 0; i < count; i++) {
      const id = GetPlayerFromIndex(i);
      if (id !== null && id !== undefined) list.push(id);
    }
  } catch (_e) {}

  return list;
}

/**
 * Coleta telemetria enriquecida de todos os jogadores conectados (Pilar 2)
 */
function collectPlayerData() {
  const players = [];
  const playerIds = getConnectedPlayerIds();

  for (const rawId of playerIds) {
    const playerId = parseInt(rawId);
    if (!Number.isInteger(playerId)) continue;

    const idStr = String(playerId);
    const ped = GetPlayerPed(idStr) || GetPlayerPed(playerId);
    if (!ped || ped === 0) continue;

    const coords = GetEntityCoords(ped);
    const x = (coords && typeof coords[0] === 'number') ? coords[0] : (coords?.x ?? 0.0);
    const y = (coords && typeof coords[1] === 'number') ? coords[1] : (coords?.y ?? 0.0);
    const z = (coords && typeof coords[2] === 'number') ? coords[2] : (coords?.z ?? 0.0);

    const rawHealth = typeof GetEntityHealth === 'function' ? GetEntityHealth(ped) : 200;
    const health = Math.max(0, Math.min(200, parseInt(rawHealth) - 100));
    const armor = typeof GetPedArmour === 'function' ? Math.max(0, Math.min(100, parseInt(GetPedArmour(ped)))) : 0;
    const heading = typeof GetEntityHeading === 'function' ? (parseFloat(GetEntityHeading(ped)) || 0.0) : 0.0;
    const ping = typeof GetPlayerPing === 'function' ? Math.max(0, parseInt(GetPlayerPing(idStr)) || 0) : 0;

    let steamName = GetPlayerName(idStr) || `Player ${playerId}`;
    let characterName = characterNameCache.get(playerId) || steamName;
    let dossier = null;

    // ─── Enriquecimento RP via QBX Core (Pilar 2: Dossiê do Cidadão) ───
    try {
      if (exports?.qbx_core?.GetPlayer) {
        const qbxPlayer = exports.qbx_core.GetPlayer(playerId);
        if (qbxPlayer?.PlayerData) {
          const pd = qbxPlayer.PlayerData;
          const char = pd.charinfo || {};
          if (char.firstname && char.lastname) {
            characterName = `${char.firstname} ${char.lastname}`;
            characterNameCache.set(playerId, characterName);
          }

          dossier = {
            citizenid: pd.citizenid || 'N/A',
            cid: pd.cid ?? 1,
            license: pd.license || '',
            firstname: char.firstname || '',
            lastname: char.lastname || '',
            birthdate: char.birthdate || '',
            gender: char.gender === 0 ? 'M' : (char.gender === 1 ? 'F' : 'Outro'),
            phone: char.phone || 'Sem telefone',
            job: {
              name: pd.job?.name || 'unemployed',
              label: pd.job?.label || 'Desempregado',
              gradeName: pd.job?.grade?.name || 'Iniciante',
              gradeLevel: pd.job?.grade?.level ?? 0,
              onduty: Boolean(pd.job?.onduty),
            },
            gang: {
              name: pd.gang?.name || 'none',
              label: pd.gang?.label || 'Nenhuma',
              gradeName: pd.gang?.grade?.name || 'Membro',
            },
            money: {
              cash: pd.money?.cash || 0,
              bank: pd.money?.bank || 0,
              crypto: pd.money?.crypto || 0,
              gems: pd.money?.gems || 0,
            },
          };
        }
      }
    } catch (_e) {}

    // ─── Detecção de Voz em Tempo Real (pma-voice / Mumble / StateBag) ───
    let isTalking = false;
    try {
      if (typeof MumbleIsPlayerTalking === 'function') {
        isTalking = Boolean(MumbleIsPlayerTalking(playerId) || MumbleIsPlayerTalking(ped));
      } else if (typeof Player === 'function') {
        const plyObj = Player(idStr);
        if (plyObj?.state?.talking !== undefined) {
          isTalking = Boolean(plyObj.state.talking);
        }
      }
    } catch (_e) {}

    const isVoiceMuted = voiceMutedPlayers.has(playerId) || Boolean(Player(idStr)?.state?.muted);
    const isChatMuted = chatMutedPlayers.has(playerId) || Boolean(Player(idStr)?.state?.chatMuted);
    const isInMultichar = !dossier;

    // ─── Telemetria Veicular (Pilar 2: OneSync) ─────────────────────
    let vehicleData = null;
    try {
      const veh = GetVehiclePedIsIn(ped, false);
      if (veh && veh !== 0) {
        const plate = GetVehicleNumberPlateText(veh);
        const model = GetEntityModel(veh);
        const vel = GetEntityVelocity(veh);
        const vx = vel && typeof vel[0] === 'number' ? vel[0] : (vel?.x ?? 0.0);
        const vy = vel && typeof vel[1] === 'number' ? vel[1] : (vel?.y ?? 0.0);
        const vz = vel && typeof vel[2] === 'number' ? vel[2] : (vel?.z ?? 0.0);
        const speedKmh = Math.round(Math.sqrt(vx * vx + vy * vy + vz * vz) * 3.6);
        const engineHealth = Math.max(0, Math.min(1000, Math.round(GetVehicleEngineHealth(veh))));

        vehicleData = {
          inVehicle: true,
          plate: plate ? plate.trim() : 'UNKNOWN',
          model: model,
          speedKmH: speedKmh,
          engineHealth: engineHealth,
          enginePercent: Math.round(engineHealth / 10),
        };
      }
    } catch (_e) {}

    players.push({
      id: playerId,
      name: (dossier ? `${characterName} (${steamName})` : `${steamName} [Criando/Selecionando]`).slice(0, 64),
      steamName: steamName,
      characterName: characterName,
      cid: dossier?.cid || 1,
      isInMultichar: isInMultichar,
      ping: ping,
      x: parseFloat(x) || 0.0,
      y: parseFloat(y) || 0.0,
      z: parseFloat(z) || 0.0,
      health: health,
      armor: armor,
      heading: ((heading % 360) + 360) % 360,
      isFrozen: frozenPlayers.has(playerId),
      isTalking: isTalking,
      isVoiceMuted: isVoiceMuted,
      isChatMuted: isChatMuted,
      dossier: dossier,
      vehicle: vehicleData,
    });
  }

  return players;
}

/**
 * Envia dados via POST HTTP como canal redundante de telemetria
 */
function httpPost(targetUrl, data, headers) {
  try {
    const parsed = new URL(targetUrl);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 2000,
    };

    const req = http.request(options, (res) => {
      res.resume();
    });

    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch (_err) {}
}

/**
 * Envia telemetria imediatamente para o backend
 */
function sendTelemetryNow() {
  const players = collectPlayerData();
  lastTelemetrySentAt = Date.now();

  // Envia via Socket.io se conectado (alta performance, sub-ms)
  if (serverSocket && serverSocket.connected) {
    serverSocket.emit('players_update', players);
  } else {
    // Fallback via HTTP POST
    const payload = JSON.stringify(players);
    const targetUrl = `${BACKEND_URL}/api/ingest`;
    httpPost(targetUrl, payload, {
      'Content-Type': 'application/json',
      'x-api-key': API_SECRET,
    });
  }
}

/**
 * Envio periódico da telemetria contínua ao backend do Dashboard (1000ms padrão)
 */
let telemetryTimer = setInterval(() => {
  const now = Date.now();
  const targetInterval = (FW_CONFIG && FW_CONFIG.TELEMETRY_INTERVAL) ? FW_CONFIG.TELEMETRY_INTERVAL : 1000;

  if (now - lastTelemetrySentAt >= targetInterval) {
    sendTelemetryNow();
  }
}, 1000);

// Limpeza e sincronização de jogadores
on('playerDropped', () => {
  const src = source;
  if (src) {
    const id = parseInt(src);
    frozenPlayers.delete(id);
    voiceMutedPlayers.delete(id);
    chatMutedPlayers.delete(id);
    characterNameCache.delete(id);
    sendTelemetryNow();
  }
});

// Suporte ao ciclo de vida Multichar (mri_Qmultichar / qbx_core / QBCore)
onNet('QBCore:Server:PlayerLoaded', (player) => {
  try {
    const src = player?.PlayerData?.source || source;
    if (src) {
      const char = player?.PlayerData?.charinfo || {};
      if (char.firstname && char.lastname) {
        characterNameCache.set(parseInt(src), `${char.firstname} ${char.lastname}`);
      }
      sendTelemetryNow();
    }
  } catch (_e) {}
});

onNet('qbx_core:server:playerLoaded', (player) => {
  try {
    const src = player?.PlayerData?.source || source;
    if (src) {
      const char = player?.PlayerData?.charinfo || {};
      if (char.firstname && char.lastname) {
        characterNameCache.set(parseInt(src), `${char.firstname} ${char.lastname}`);
      }
      sendTelemetryNow();
    }
  } catch (_e) {}
});

onNet('QBCore:Server:OnPlayerUnload', (src) => {
  try {
    const targetSrc = src || source;
    if (targetSrc) {
      const id = parseInt(targetSrc);
      characterNameCache.delete(id);
      frozenPlayers.delete(id);
      voiceMutedPlayers.delete(id);
      chatMutedPlayers.delete(id);
      sendTelemetryNow();
    }
  } catch (_e) {}
});

onNet('qbx_core:server:onPlayerUnload', (src) => {
  try {
    const targetSrc = src || source;
    if (targetSrc) {
      const id = parseInt(targetSrc);
      characterNameCache.delete(id);
      frozenPlayers.delete(id);
      voiceMutedPlayers.delete(id);
      chatMutedPlayers.delete(id);
      sendTelemetryNow();
    }
  } catch (_e) {}
});

on('playerDropped', () => {
  try {
    const src = source;
    if (src) {
      const id = parseInt(src);
      characterNameCache.delete(id);
      frozenPlayers.delete(id);
      voiceMutedPlayers.delete(id);
      chatMutedPlayers.delete(id);
      sendTelemetryNow();
    }
  } catch (_e) {}
});

on('onResourceStart', (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;

  initServerSocket();

  console.log('');
  console.log('  ╔═════════════════════════════════════════════════════════╗');
  console.log('  ║       Vanguard Dashboard — FiveM Resource Ativo         ║');
  console.log(`  ║       Backend URL: ${BACKEND_URL.padEnd(36)} ║`);
  console.log('  ╚═════════════════════════════════════════════════════════╝');
  console.log('');
});

on('onResourceStop', (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }
  if (serverSocket) {
    try { serverSocket.disconnect(); } catch (_e) {}
    serverSocket = null;
  }
  console.log('[vanguard_dashboard] Resource parado com sucesso.');
});
