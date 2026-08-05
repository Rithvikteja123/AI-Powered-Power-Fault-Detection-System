import { useState, useEffect, useCallback, useRef } from 'react';
import Dashboard from './pages/Dashboard.jsx';

// Relative URL works for both:
//  - Local dev: Vite proxies /api → localhost:5050
//  - Vercel:    /api/* → serverless function
const API = import.meta.env.VITE_API_URL || '';

// Try WebSocket first (local dev). Fall back to polling on Vercel (wss:// not supported on serverless).
const IS_VERCEL   = import.meta.env.PROD && !import.meta.env.VITE_WS_URL;
const WS_URL      = import.meta.env.VITE_WS_URL ||
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
const POLL_MS     = 8_000;  // Poll interval when WebSocket unavailable

export default function App() {
  const [tickets, setTickets]       = useState([]);
  const [stats, setStats]           = useState({});
  const [poleStates, setPoleStates] = useState(new Map());
  const [wsStatus, setWsStatus]     = useState('connecting');
  const [toasts, setToasts]         = useState([]);
  const [simStatus, setSimStatus]   = useState('');
  const [theme, setTheme]           = useState(() => localStorage.getItem('pf-theme') || 'light');
  const wsRef        = useRef(null);
  const prevTickets  = useRef([]);

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pf-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => t === 'light' ? 'dark' : 'light'), []);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/tickets`);
      const data = await res.json();
      const next = data.tickets || [];

      // Detect new faults compared to previous fetch (used in polling mode)
      if (IS_VERCEL && prevTickets.current.length > 0) {
        const prevIds = new Set(prevTickets.current.map(t => t.id));
        const newOnes = next.filter(t => !prevIds.has(t.id));
        newOnes.forEach(t => addToast(`🚨 New fault — ${t.fault_type} at PIN ${t.pincode || '?'}`, 'danger'));
      }
      prevTickets.current = next;
      setTickets(next);
    } catch (e) { console.error('fetchTickets', e); }
  }, [addToast]);

  const fetchStats = useCallback(async () => {
    try {
      const res  = await fetch(`${API}/api/stats`);
      const data = await res.json();
      setStats(data);
    } catch (_) {}
  }, []);

  // ── WebSocket (local dev & self-hosted only) ───────────────────────────────
  const connectWs = useCallback(() => {
    if (IS_VERCEL) return;                                      // skip WS on Vercel
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen  = () => setWsStatus('connected');
    ws.onerror = () => setWsStatus('disconnected');
    ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connectWs, 3000); };

    ws.onmessage = (e) => {
      try {
        const { type, data } = JSON.parse(e.data);
        if (type === 'ticket_created') {
          setTickets(p => [data, ...p]);
          addToast(`🚨 New fault — ${data.fault_type} at PIN ${data.pincode || '?'}`, 'danger');
          fetchStats(); fetchTickets();
        } else if (type === 'ticket_updated') {
          setTickets(p => p.map(t => t.id === data.id ? { ...t, ...data } : t));
          fetchStats(); fetchTickets();
        } else if (type === 'ticket_closed') {
          setTickets(p => p.filter(t => t.id !== data.id));
          addToast('✅ Fault cleared — power restored', 'success');
          fetchStats(); fetchTickets();
        } else if (type === 'pole_state_changed') {
          setPoleStates(prev => {
            const next = new Map(prev);
            next.set(data.pole_id, { energized: data.energized, ts: data.ts });
            return next;
          });
          fetchStats();
        } else if (type === 'simulation_started') {
          setSimStatus(data.message);
          addToast(`⚡ ${data.message}`, 'warning');
          setTimeout(() => setSimStatus(''), 10_000);
          fetchStats(); fetchTickets();
        } else if (type === 'simulation_repaired') {
          setSimStatus(data.message);
          addToast(`🔧 ${data.message}`, 'info');
          setTimeout(() => setSimStatus(''), 10_000);
          fetchStats(); fetchTickets();
        }
      } catch (_) {}
    };
  }, [addToast, fetchStats, fetchTickets]);

  // ── Init + polling fallback ─────────────────────────────────────────────────
  useEffect(() => {
    fetchTickets();
    fetchStats();

    if (IS_VERCEL) {
      // Vercel: no persistent WS → poll every 8 seconds
      setWsStatus('connected');   // show "Connected" via polling
      const poll = setInterval(() => { fetchTickets(); fetchStats(); }, POLL_MS);
      return () => clearInterval(poll);
    } else {
      // Local / Render: use real WebSocket + background polling
      connectWs();
      const statsI   = setInterval(fetchStats, 10_000);
      const ticketsI = setInterval(fetchTickets, 30_000);
      return () => {
        clearInterval(statsI);
        clearInterval(ticketsI);
        wsRef.current?.close();
      };
    }
  }, [fetchTickets, fetchStats, connectWs]);

  return (
    <>
      <Dashboard
        tickets={tickets}
        stats={stats}
        poleStates={poleStates}
        wsStatus={wsStatus}
        simStatus={simStatus}
        theme={theme}
        onToggleTheme={toggleTheme}
        onTicketsChange={fetchTickets}
        onAddToast={addToast}
        apiBase={API}
      />

      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            <span style={{ fontSize: 15 }}>
              {t.type === 'danger' ? '🚨' : t.type === 'success' ? '✅' : t.type === 'warning' ? '⚡' : 'ℹ️'}
            </span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </>
  );
}
