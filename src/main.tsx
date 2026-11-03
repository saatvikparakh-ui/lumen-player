import React, { Component, ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { initApiInterceptor } from './services/apiConfig';
import { ApiClient } from './services/apiClient';

// Initialize global API routing for web, native Android APK, and desktop
initApiInterceptor();

const isNativeMobile = ApiClient.isCapacitor();

// In native mobile Capacitor containers, proactively unregister any lingering service workers
// from previous PWA installs so they never intercept local APK assets or cause white screens
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (isNativeMobile) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const r of registrations) {
        r.unregister().catch(() => {});
      }
    }).catch(() => {});
  } else if (window.location.protocol.startsWith('http')) {
    // Only register Service Worker for Desktop Browser PWA installation
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Lumen Crash]:', error, errorInfo);
  }

  handleReset = () => {
    try {
      localStorage.removeItem('lumen_active_backend');
      localStorage.removeItem('lumen_server_url');
    } catch (_) {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          backgroundColor: '#080A10',
          color: '#ffffff',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          fontFamily: 'sans-serif'
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>Lumen Audio</h2>
          <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: '16px', maxWidth: '300px' }}>
            {this.state.error?.message || 'Recovering state...'}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              backgroundColor: '#00F0FF',
              color: '#000000',
              fontWeight: 'bold',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
