/**
 * main.jsx — Vite entry point for fivem-watch dashboard.
 * Renders the root App component into #root.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary title="Painel Vanguard — Contingência Ativa" showReload={true}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
