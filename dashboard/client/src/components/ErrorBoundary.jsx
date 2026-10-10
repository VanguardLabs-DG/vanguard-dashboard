import React from 'react';
import { WarningOctagon, ArrowsClockwise, Trash } from '@phosphor-icons/react';

/**
 * ErrorBoundary.jsx — Resilient error containment for Vanguard Dashboard
 * 
 * Prevents uncaught React render exceptions from crashing the application or
 * unmounting the root DOM tree (preventing the "black screen of death").
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Vanguard Dashboard] Uncaught Error caught by ErrorBoundary:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleClearAndReload = () => {
    try {
      localStorage.removeItem('fivem-watch-token');
      localStorage.removeItem('fivem-watch-user');
      sessionStorage.clear();
    } catch (_e) {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error, this.handleReset);
        }
        return this.props.fallback;
      }

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 24px',
            background: 'var(--color-surface, #0e1524)',
            border: '1px solid var(--color-border, rgba(148, 163, 184, 0.15))',
            borderRadius: 'var(--radius-md, 10px)',
            color: 'var(--color-text, #f8fafc)',
            textAlign: 'center',
            maxWidth: '520px',
            margin: '40px auto',
            boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
            }}
          >
            <WarningOctagon size={28} weight="bold" />
          </div>

          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 700 }}>
            {this.props.title || 'Inconsistência Detectada no Módulo'}
          </h3>

          <p
            style={{
              margin: '0 0 16px 0',
              fontSize: '0.85rem',
              color: 'var(--color-text-secondary, #94a3b8)',
              lineHeight: 1.5,
            }}
          >
            {this.props.message ||
              'O navegador detectou uma inconsistência de dados ou cache antigo ao processar este componente. O restante do painel continua ativo.'}
          </p>

          {/* Detalhes Técnicos Expansíveis */}
          {this.state.error && (
            <details
              style={{
                width: '100%',
                textAlign: 'left',
                margin: '0 0 20px 0',
                background: 'rgba(0, 0, 0, 0.3)',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <summary style={{ cursor: 'pointer', color: 'var(--color-text-secondary, #94a3b8)', fontWeight: 600 }}>
                Ver detalhes técnicos do erro
              </summary>
              <pre
                style={{
                  marginTop: '8px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: '#ef4444',
                  fontFamily: 'monospace',
                  maxHeight: '120px',
                  overflowY: 'auto',
                }}
              >
                {this.state.error.message || String(this.state.error)}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={this.handleReset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                background: 'var(--color-accent, #10b981)',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <ArrowsClockwise size={16} weight="bold" />
              <span>Tentar Novamente</span>
            </button>

            <button
              onClick={this.handleClearAndReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
              title="Limpar sessão antiga e forçar tela de login limpa"
            >
              <Trash size={16} />
              <span>Limpar Cache & Login</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
