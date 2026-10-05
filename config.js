/**
 * config.js — Configuração do recurso vanguard_dashboard (fivem-watch).
 */

const FW_CONFIG = {
  /** URL pública externa acessada pelos clientes NUI no PC dos jogadores (HTTPS/WSS via Caddy com certificado TLS válido) */
  PUBLIC_BACKEND_URL: 'https://137.131.156.73.sslip.io',

  /** URL local para telemetria enviada pelo script Server do FiveM */
  SERVER_BACKEND_URL: 'http://127.0.0.1:3001',

  /** Chave secreta sincronizada com o backend (.env) */
  API_SECRET: '57fe803f8d945ab7228f35f41e3848724ef5940446443b203729215f018c85b7',

  /** Intervalo em ms para envio de telemetria de jogadores */
  TELEMETRY_INTERVAL: 1000,

  /** FPS da transmissão de tela */
  STREAM_FPS: 20,

  /** Qualidade de compressão WebP (0.1 a 1.0) */
  STREAM_QUALITY: 0.5,

  /** Escala de resolução do stream (0.1 a 1.0) */
  STREAM_RESOLUTION_SCALE: 0.5,
};
