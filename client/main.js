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
