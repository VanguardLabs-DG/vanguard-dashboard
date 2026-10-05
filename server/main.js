/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  vanguard_dashboard — Server Script (main.js)               ║
 * ║  Coleta telemetria dos jogadores e envia para o backend     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Coleta em tempo real:
 * - ID do servidor
 * - Nome (Steam/FiveM + Personagem RP via QBX Core)
 * - Coordenadas (X, Y, Z)
 * - Saúde (0-200) e Colete (0-100)
 * - Ping e Direção (Heading)
 */

const http = require('http');

/**
 * Envia dados via POST HTTP usando módulo nativo do Node.js
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

    req.on('error', (err) => {
      // Backend inacessível no momento
    });

    req.write(data);
    req.end();
  } catch (err) {
    console.warn('[vanguard_dashboard] Erro HTTP ao enviar telemetria:', err.message);
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
 * Coleta telemetria de todos os jogadores conectados
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

    let playerName = GetPlayerName(idStr) || `Player ${playerId}`;

    // Enriquece com nome do personagem QBX Core se disponível
    try {
      if (exports?.qbx_core?.GetPlayer) {
        const qbxPlayer = exports.qbx_core.GetPlayer(playerId);
        if (qbxPlayer?.PlayerData?.charinfo) {
          const char = qbxPlayer.PlayerData.charinfo;
          if (char.firstname && char.lastname) {
            playerName = `${char.firstname} ${char.lastname} (${playerName})`;
          }
        }
      }
    } catch (_e) {}

    players.push({
      id: playerId,
      name: playerName.slice(0, 64),
      ping: ping,
      x: parseFloat(x) || 0.0,
      y: parseFloat(y) || 0.0,
      z: parseFloat(z) || 0.0,
      health: health,
      armor: armor,
      heading: ((heading % 360) + 360) % 360,
    });
  }

  return players;
}

/**
 * Envio periódico da telemetria ao backend do Dashboard
 */
setInterval(() => {
  const players = collectPlayerData();
  const payload = JSON.stringify(players);
  const targetUrl = `${FW_CONFIG.SERVER_BACKEND_URL || 'http://127.0.0.1:3001'}/api/ingest`;

  httpPost(targetUrl, payload, {
    'Content-Type': 'application/json',
    'x-api-key': FW_CONFIG.API_SECRET,
  });
}, FW_CONFIG.TELEMETRY_INTERVAL);

on('onResourceStart', (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;

  const sUrl = FW_CONFIG.SERVER_BACKEND_URL || 'http://127.0.0.1:3001';
  console.log('');
  console.log('  ╔═════════════════════════════════════════════════════════╗');
  console.log('  ║       Vanguard Dashboard — FiveM Resource Ativo         ║');
  console.log(`  ║       Backend URL: ${sUrl.padEnd(36)} ║`);
  console.log('  ╚═════════════════════════════════════════════════════════╝');
  console.log('');
});
