/**
 * LiveStream.jsx — Picture-in-Picture & Grid live screen surveillance viewer.
 *
 * Pilar 1: Telagem & Moderação Avançada
 * - Buffer de clipe instantâneo / Gravação de Prova (.webm)
 * - Captura de Screenshot instantâneo (.png)
 * - Suporte a Multi-Stream simultâneo
 * - Ações rápidas de moderação in-stream
 *
 * @module LiveStream
 */

import { useEffect, useState, useRef } from 'react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import {
  X,
  VideoCamera,
  CircleNotch,
  CornersOut,
  Gear,
  Record,
  Camera,
  Snowflake,
  FirstAid,
  Bandaids,
  User,
  CheckCircle,
} from '@phosphor-icons/react';
import { getSocket } from '../socket';

// Quality presets for the stream
const QUALITY_PRESETS = {
  Low: { streamFps: 10, resolutionScale: 0.2, streamQuality: 0.3 },
  Medium: { streamFps: 20, resolutionScale: 0.4, streamQuality: 0.5 },
  High: { streamFps: 30, resolutionScale: 0.7, streamQuality: 0.8 },
};

export default function LiveStream({
  playerId,
  playerName,
  indexOffset = 0,
  isGridMode = false,
  onClose,
  onOpenDossier,
}) {
  const [frame, setFrame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // ─── Gravação de Prova (Pilar 1: Video Clip / MediaRecorder) ───
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const canvasRef = useRef(null);
  const recordTimerRef = useRef(null);

  const [qualityLevel, setQualityLevel] = useState(() => {
    try {
      const saved = localStorage.getItem('fivem-watch-quality');
      if (saved && QUALITY_PRESETS[saved]) return saved;
    } catch {
      // ignore
    }
    return 'Medium';
  });

  // Sync quality settings to NUI client whenever level changes
  useEffect(() => {
    if (!playerId) return;
    const socket = getSocket();
    if (socket) {
      socket.emit('update_stream_config', {
        playerId,
        config: QUALITY_PRESETS[qualityLevel],
      });
    }
    localStorage.setItem('fivem-watch-quality', qualityLevel);
  }, [qualityLevel, playerId]);

  // Recebimento de Frames e desenho no Canvas interno
  useEffect(() => {
    const socket = getSocket();
    if (!socket || playerId == null) return;

    const handleFrame = (data) => {
      if (String(data.playerId) === String(playerId)) {
        setFrame(data.frame);
        if (loading) setLoading(false);

        // Desenha no canvas auxiliar para permitir gravação e prints sem cross-origin
        if (canvasRef.current && data.frame) {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== img.width || canvas.height !== img.height) {
                canvas.width = img.width;
                canvas.height = img.height;
              }
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
              }
            }
          };
          img.src = data.frame;
        }
      }
    };

    socket.on('player_frame', handleFrame);

    return () => {
      socket.off('player_frame', handleFrame);
    };
  }, [playerId, loading]);

  // Temporizador da Gravação de Prova
  useEffect(() => {
    if (isRecording) {
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s >= 30) {
            stopRecording();
            return 0;
          }
          return s + 1;
        });
      }, 1000);
    } else {
      clearInterval(recordTimerRef.current);
      setRecordSeconds(0);
    }
    return () => clearInterval(recordTimerRef.current);
  }, [isRecording]);

  const showToast = (text) => {
    setToastMessage(text);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ─── Iniciar Gravação de Prova ─────────────────────────────────
  const startRecording = () => {
    if (!canvasRef.current) {
      showToast('Aguarde os frames carregarem.');
      return;
    }

    try {
      const stream = canvasRef.current.captureStream(20);
      recordedChunksRef.current = [];

      let mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `prova-telagem-player-${playerId}-${timestamp}.webm`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);
        showToast('Vídeo de prova salvo com sucesso!');
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      showToast('Gravação iniciada (máx 30s)...');
    } catch (err) {
      console.error('[LiveStream] Erro ao gravar stream:', err);
      showToast('Erro ao iniciar gravação.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  // ─── Capturar Foto / Snapshot Instantâneo ─────────────────────
  const captureSnapshot = () => {
    if (!canvasRef.current || !frame) {
      showToast('Nenhum frame disponível.');
      return;
    }

    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `screenshot-player-${playerId}-${timestamp}.png`;
      a.click();
      showToast('Screenshot capturado!');
    } catch (err) {
      console.error('[LiveStream] Erro ao tirar snapshot:', err);
    }
  };

  // ─── Ações Rápidas In-Stream (Pilar 3) ─────────────────────────
  const triggerQuickAction = (action, options = {}) => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit(
      'admin_action',
      {
        action,
        targetPlayerId: playerId,
        options,
        adminName: 'Operador Vanguard',
      },
      (res) => {
        if (res && res.success) {
          showToast(res.message || 'Comando executado!');
        } else {
          showToast(res?.error || 'Erro na ação');
        }
      }
    );
  };

  if (playerId == null) return null;

  return (
    <AnimatePresence>
      <Motion.div
        className={`stream-overlay ${isMaximized ? 'maximized' : ''} ${isGridMode ? 'grid-item' : ''}`}
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        animate={{
          opacity: 1,
          y: 0,
          x: 0,
          scale: 1,
          width: isMaximized ? '100vw' : undefined,
          height: isMaximized ? '100vh' : undefined,
        }}
        exit={{ opacity: 0, y: 40, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
        style={
          isMaximized
            ? {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 9999,
                borderRadius: 0,
                resize: 'none',
              }
            : isGridMode
            ? {
                position: 'relative',
                width: '100%',
                height: '100%',
                resize: 'none',
              }
            : {
                position: 'absolute',
                top: `${80 + indexOffset * 35}px`,
                right: `${20 + indexOffset * 30}px`,
                zIndex: 1000 + indexOffset,
                resize: 'both',
              }
        }
      >
        {/* Stream Header */}
        <div className="stream-header">
          <div className="stream-header-left">
            <div className={`stream-live-dot ${isRecording ? 'recording' : ''}`} />
            <span className="stream-header-title">
              #{playerId} {playerName || 'Unknown'}
            </span>
            {isRecording && (
              <span className="rec-badge font-mono">
                REC 00:{recordSeconds < 10 ? `0${recordSeconds}` : recordSeconds}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* Botão Gravar Prova */}
            <button
              className={`btn-stream-action ${isRecording ? 'recording' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              title={isRecording ? 'Parar e baixar prova (.webm)' : 'Gravar clipe de evidência (máx 30s)'}
            >
              <Record size={16} weight={isRecording ? 'fill' : 'bold'} />
            </button>

            {/* Botão Tirar Print */}
            <button
              className="btn-stream-action"
              onClick={captureSnapshot}
              title="Tirar foto / snapshot instantâneo (.png)"
            >
              <Camera size={16} weight="bold" />
            </button>

            {/* Dossiê / Inventário do Jogador */}
            {onOpenDossier && (
              <button
                className="btn-stream-action"
                onClick={() => onOpenDossier(playerId)}
                title="Abrir Dossiê e Inventário"
              >
                <User size={16} weight="bold" />
              </button>
            )}

            {/* Stream Settings */}
            <button
              className={`btn-icon ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
              title="Configurações de Qualidade"
            >
              <Gear size={16} weight={showSettings ? 'fill' : 'regular'} />
            </button>

            {/* Maximizar */}
            {!isGridMode && (
              <button
                className="btn-icon"
                onClick={() => setIsMaximized(!isMaximized)}
                title={isMaximized ? 'Restaurar janela' : 'Maximizar'}
              >
                <CornersOut size={16} weight={isMaximized ? 'fill' : 'regular'} />
              </button>
            )}

            {/* Fechar */}
            <button
              className="stream-close-btn"
              onClick={onClose}
              title="Encerrar telagem"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Stream Canvas Layer */}
        <div
          className="stream-canvas"
          style={{
            height: isMaximized ? 'calc(100vh - 84px)' : 'calc(100% - 76px)',
            minHeight: '200px',
            position: 'relative',
          }}
        >
          {/* Canvas oculto para MediaRecorder e snapshots sem taint */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {loading ? (
            <div className="stream-placeholder">
              <CircleNotch size={32} style={{ animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <span style={{ marginTop: 8 }}>Conectando à tela do jogador #{playerId}...</span>
            </div>
          ) : frame ? (
            <img src={frame} alt={`Live view of player #${playerId}`} draggable={false} />
          ) : (
            <div className="stream-placeholder">
              <VideoCamera size={32} />
              <span style={{ marginTop: 8 }}>Aguardando fluxo de vídeo...</span>
            </div>
          )}

          {/* Toast Notification In-Stream */}
          <AnimatePresence>
            {toastMessage && (
              <Motion.div
                className="stream-toast"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
              >
                <CheckCircle size={14} weight="fill" className="text-accent" />
                <span>{toastMessage}</span>
              </Motion.div>
            )}
          </AnimatePresence>

          {/* Dropdown de Qualidade */}
          <AnimatePresence>
            {showSettings && (
              <Motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="stream-settings-overlay"
              >
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                  Qualidade da Transmissão:
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {Object.keys(QUALITY_PRESETS).map((level) => (
                    <button
                      key={level}
                      onClick={() => {
                        setQualityLevel(level);
                        setShowSettings(false);
                      }}
                      className={`btn-quality-chip ${qualityLevel === level ? 'active' : ''}`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </Motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Barra de Ações Rápidas In-Stream (Pilar 3) */}
        <div className="stream-action-bar">
          <button
            className="btn-quick-stream freeze"
            onClick={() => triggerQuickAction('freeze', {})}
            title="Alternar Congelamento"
          >
            <Snowflake size={14} weight="bold" />
            <span>Freeze</span>
          </button>
          <button
            className="btn-quick-stream revive"
            onClick={() => triggerQuickAction('revive')}
            title="Reviver Jogador"
          >
            <FirstAid size={14} weight="bold" />
            <span>Revive</span>
          </button>
          <button
            className="btn-quick-stream heal"
            onClick={() => triggerQuickAction('heal')}
            title="Curar Vida e Colete"
          >
            <Bandaids size={14} weight="bold" />
            <span>Heal</span>
          </button>
          {onOpenDossier && (
            <button
              className="btn-quick-stream dossier"
              onClick={() => onOpenDossier(playerId)}
              title="Abrir Dossiê Completo"
            >
              <User size={14} weight="bold" />
              <span>Dossiê & Inv</span>
            </button>
          )}
        </div>
      </Motion.div>
    </AnimatePresence>
  );
}
