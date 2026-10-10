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

// Rastreamento local de jogadores congelados
const frozenPlayers = new Set();
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

    // ─── RPC: Consulta em tempo real de Inventário (ox_inventory) ───
    serverSocket.on('get_player_inventory', (data, callback) => {
      const targetId = parseInt(data?.playerId);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        if (typeof callback === 'function') callback({ success: false, error: 'ID de jogador inválido' });
        return;
      }

      try {
        const inv = getPlayerInventoryData(targetId);
        if (typeof callback === 'function') {
          callback({ success: true, inventory: inv });
        }
      } catch (err) {
        console.error(`[vanguard_dashboard] Erro ao consultar ox_inventory para #${targetId}:`, err.message);
        if (typeof callback === 'function') callback({ success: false, error: err.message });
      }
    });

    // ─── RPC: Execução de Ações Administrativas Remotas (Pilar 3) ──
    serverSocket.on('admin_action', (data, callback) => {
      const { action, targetPlayerId, options, adminName } = data || {};
      const targetId = parseInt(targetPlayerId);

      if (!Number.isInteger(targetId) || targetId <= 0) {
        if (typeof callback === 'function') callback({ success: false, error: 'ID de jogador inválido' });
        return;
      }

      console.log(`[vanguard_dashboard] [Ação Remota] ${adminName || 'Admin'} executou '${action}' em #${targetId}`);

      const result = executeAdminAction(action, targetId, options || {}, adminName || 'Administrador');
      if (typeof callback === 'function') {
        callback(result);
      }
    });

  } catch (err) {
    console.error('[vanguard_dashboard] Erro ao inicializar socket server:', err.message);
  }
}

// ─── Execução de Ações Administrativas (Pilar 3) ───────────────
function executeAdminAction(action, targetId, options, adminName) {
  const idStr = String(targetId);
  const ped = GetPlayerPed(idStr) || GetPlayerPed(targetId);

  if (!ped || ped === 0) {
    return { success: false, error: `Jogador #${targetId} não foi encontrado no servidor.` };
  }

  try {
    switch (action) {
      // 1. Freeze / Unfreeze
      case 'freeze': {
        const shouldFreeze = options.toggle !== undefined ? Boolean(options.toggle) : !frozenPlayers.has(targetId);
        if (typeof FreezeEntityPosition === 'function') {
          try { FreezeEntityPosition(ped, shouldFreeze); } catch (_e) {}
        }
        emitNet('vanguard_dashboard:client:freeze', targetId, shouldFreeze);

        if (shouldFreeze) {
          frozenPlayers.add(targetId);
        } else {
          frozenPlayers.delete(targetId);
        }

        // Notifica o jogador
        try {
          emitNet('ox_lib:notify', targetId, {
            title: 'Administração',
            description: shouldFreeze ? 'Você foi congelado por um administrador.' : 'Você foi descongelado.',
            type: shouldFreeze ? 'warning' : 'inform',
            duration: 5000,
          });
        } catch (_e) {}

        return {
          success: true,
          message: shouldFreeze ? `Jogador #${targetId} congelado com sucesso.` : `Jogador #${targetId} descongelado com sucesso.`,
          isFrozen: shouldFreeze,
        };
      }

      // 2. Reviver
      case 'revive': {
        // Dispara nosso evento cliente dedicado
        emitNet('vanguard_dashboard:client:revive', targetId);

        // Dispara eventos padrão de compatibilidade (Qbox / QBX Medical / ESX / ARS)
        emitNet('hospital:client:Revive', targetId);
        emitNet('qbx_medical:client:revive', targetId);
        emitNet('QBCore:Client:Revive', targetId);
        emitNet('ars_ambulancejob:healPlayer', targetId, { revive: true });

        // Se QBX Core estiver presente, restabelece fome, sede e stress
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

        // Limpa estado de óbito se houver dp_obito
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
        // Dispara evento cliente dedicado que executa SetEntityHealth e SetPedArmour
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

      // 4. Teletransporte (Teleport para Coordenadas ou Local Pré-definido)
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

      // 5. Mensagem de Alerta / Aviso (Warn / DM)
      case 'warn': {
        const msg = String(options.message || '').trim();
        if (!msg) {
          return { success: false, error: 'Mensagem de aviso não pode estar vazia.' };
        }

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

        return { success: true, message: `Aviso enviado com sucesso para #${targetId}.` };
      }

      // 6. Expulsão (Kick)
      case 'kick': {
        const reason = String(options.reason || 'Expulso pela administração do servidor.').trim();
        DropPlayer(idStr, `[Vanguard Moderation] ${reason}`);
        return { success: true, message: `Jogador #${targetId} expulso com sucesso.` };
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
    let characterName = steamName;
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
          }

          dossier = {
            citizenid: pd.citizenid || 'N/A',
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
            },
          };
        }
      }
    } catch (_e) {}

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
      name: `${characterName} (${steamName})`.slice(0, 64),
      steamName: steamName,
      characterName: characterName,
      ping: ping,
      x: parseFloat(x) || 0.0,
      y: parseFloat(y) || 0.0,
      z: parseFloat(z) || 0.0,
      health: health,
      armor: armor,
      heading: ((heading % 360) + 360) % 360,
      isFrozen: frozenPlayers.has(playerId),
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
 * Envio periódico da telemetria ao backend do Dashboard (Adaptativo à presença de Staff)
 */
let telemetryTimer = setInterval(() => {
  const now = Date.now();
  // Quando há admins online: roda a cada TELEMETRY_INTERVAL (ex: 1000ms)
  // Quando NÃO há admins online: roda a cada 30.000ms apenas em standby
  const targetInterval = activeAdminsCount > 0 ? (FW_CONFIG.TELEMETRY_INTERVAL || 1000) : 30000;

  if (now - lastTelemetrySentAt >= targetInterval) {
    sendTelemetryNow();
  }
}, 1000);

// Limpeza de jogadores desconectados
on('playerDropped', () => {
  const src = source;
  if (src) {
    frozenPlayers.delete(parseInt(src));
  }
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
