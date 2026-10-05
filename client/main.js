/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  vanguard_dashboard — Client Script (main.js)               ║
 * ║  Ponte entre o jogo e o NUI para streaming de tela ao vivo   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

let isNUIConnected = false;

function sendConfigToNUI() {
  const pId = GetPlayerServerId(PlayerId());
  if (!pId || pId <= 0) return;

  SendNUIMessage({
    type: 'init',
    backendUrl: FW_CONFIG.PUBLIC_BACKEND_URL || 'https://137.131.156.73.sslip.io',
    apiSecret: FW_CONFIG.API_SECRET,
    playerId: pId,
    streamFps: FW_CONFIG.STREAM_FPS,
    streamQuality: FW_CONFIG.STREAM_QUALITY,
    resolutionScale: FW_CONFIG.STREAM_RESOLUTION_SCALE,
  });

  console.log(`[vanguard_dashboard] Enviando config para NUI (Player #${pId}, Endpoint: ${FW_CONFIG.PUBLIC_BACKEND_URL})`);
}

// Handshake disparado quando o DOM do NUI termina de carregar
RegisterNuiCallbackType('nuiReady');
on('__cfx_nui:nuiReady', (data, cb) => {
  cb({});
  console.log('[vanguard_dashboard] NUI carregado com sucesso. Disparando handshake...');
  sendConfigToNUI();
});

// Callback disparado quando o NUI confirma conexão de socket com o backend
RegisterNuiCallbackType('nuiConnected');
on('__cfx_nui:nuiConnected', (data, cb) => {
  cb({});
  isNUIConnected = true;
  console.log('[vanguard_dashboard] ✓ Conexão NUI ↔ Dashboard estabelecida!');
});

// Disparo ao carregar o resource
on('onClientResourceStart', (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;
  setTimeout(sendConfigToNUI, 1500);
  setTimeout(sendConfigToNUI, 3500);
});

on('onResourceStart', (resourceName) => {
  if (GetCurrentResourceName() !== resourceName) return;
  setTimeout(sendConfigToNUI, 1500);
  setTimeout(sendConfigToNUI, 3500);
});

on('playerSpawned', () => {
  setTimeout(sendConfigToNUI, 2000);
});

// Loop de garantia: caso o NUI ainda não tenha conectado, reenvia a cada 6 segundos
setInterval(() => {
  if (!isNUIConnected) {
    sendConfigToNUI();
  }
}, 6000);

RegisterCommand('reconnect_telagem', () => {
  console.log('[vanguard_dashboard] Forçando reconexão manual da telagem...');
  isNUIConnected = false;
  sendConfigToNUI();
}, false);

RegisterCommand('telagem_reset', () => {
  console.log('[vanguard_dashboard] Reinicializando NUI e motor gráfico...');
  isNUIConnected = false;
  sendConfigToNUI();
}, false);

// ─── Ações Administrativas Executadas no Cliente (Pilar 3) ────
onNet('vanguard_dashboard:client:heal', () => {
  const ped = PlayerPedId();
  if (typeof SetEntityHealth === 'function') {
    SetEntityHealth(ped, 200);
  }
  if (typeof SetPedArmour === 'function') {
    SetPedArmour(ped, 100);
  }
  if (typeof ClearPedBloodDamage === 'function') {
    ClearPedBloodDamage(ped);
  }
  console.log('[vanguard_dashboard] ✓ Heal aplicado com sucesso no cliente.');
});

onNet('vanguard_dashboard:client:revive', () => {
  const ped = PlayerPedId();
  const coords = GetEntityCoords(ped);
  if (typeof NetworkResurrectLocalPlayer === 'function') {
    const heading = typeof GetEntityHeading === 'function' ? GetEntityHeading(ped) : 0.0;
    const cx = coords && typeof coords[0] === 'number' ? coords[0] : (coords?.x ?? 0.0);
    const cy = coords && typeof coords[1] === 'number' ? coords[1] : (coords?.y ?? 0.0);
    const cz = coords && typeof coords[2] === 'number' ? coords[2] : (coords?.z ?? 0.0);
    NetworkResurrectLocalPlayer(cx, cy, cz, heading, true, false);
  }
  if (typeof SetEntityHealth === 'function') {
    SetEntityHealth(ped, 200);
  }
  if (typeof ClearPedBloodDamage === 'function') {
    ClearPedBloodDamage(ped);
  }
  console.log('[vanguard_dashboard] ✓ Revive aplicado com sucesso no cliente.');
});

onNet('vanguard_dashboard:client:freeze', (toggle) => {
  const ped = PlayerPedId();
  if (typeof FreezeEntityPosition === 'function') {
    FreezeEntityPosition(ped, Boolean(toggle));
  }
  console.log(`[vanguard_dashboard] ✓ Freeze alternado para: ${Boolean(toggle)}`);
});

onNet('vanguard_dashboard:client:teleport', (coords) => {
  if (!coords) return;
  const ped = PlayerPedId();
  if (typeof SetEntityCoords === 'function') {
    SetEntityCoords(ped, coords.x, coords.y, coords.z, false, false, false, false);
  }
  console.log(`[vanguard_dashboard] ✓ Teleportado para [${coords.x}, ${coords.y}, ${coords.z}]`);
});

