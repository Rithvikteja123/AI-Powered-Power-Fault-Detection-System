import { useState, useEffect, useCallback, useRef } from 'react';
import Dashboard from './pages/Dashboard.jsx';

// Use relative URLs so Vite proxy forwards /api → localhost:5050 (no CORS issues)
const API = import.meta.env.VITE_API_URL || '';
const WS_URL = import.meta.env.VITE_WS_URL ||
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
  window.location.host + '/ws';

export default function App() {
  const [tickets, setTickets]       = useState([]);
  const [stats, setStats]           = useState({});
  const [poleStates, setPoleStates] = useState(new Map());
  const [wsStatus, setWsStatus]     = useState('connecting');
  const [toasts, setToasts]         = useState([]);
  const [simStatus, setSimStatus]   = useState('');
  const [theme, setTheme]           = useState(() => localStorage.getItem('pf-theme') || 'light');
  const wsRef = useRef(null);

  // ── Apply theme ──────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pf-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : 'light');
  }, []);

  // ── Toast helpers ────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);

  // ── Fetch helpers ────────────────────────────────────────────────────────
  const fetchTickets = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/tickets`);
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch (e) { console.error('fetchTickets', e); }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/stats`);
      const data = await res.json();
      setStats(data);
    } catch (e) { /* silent */ }
  }, []);

  // ── WebSocket ────────────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen = () => setWsStatus('connected');

    ws.onmessage = (e) => {
      try {
        const { type, data } = JSON.parse(e.data);

        if (type === 'ticket_created') {
          setTickets(prev => [data, ...prev]);
          addToast(`🚨 New fault detected — ${data.fault_type} at PIN ${data.pincode || '?'}`, 'danger');
          fetchStats(); fetchTickets();
        } else if (type === 'ticket_updated') {
          setTickets(prev => prev.map(t => t.id === data.id ? { ...t, ...data } : t));
          fetchStats(); fetchTickets();
        } else if (type === 'ticket_closed') {
          setTickets(prev => prev.filter(t => t.id !== data.id));
          addToast('✅ Fault cleared — power restored and verified', 'success');
          fetchStats(); fetchTickets();
        } else if (type === 'pole_state_changed') {
          setPoleStates(prev => {
            const next = new Map(prev);
            next.set(data.pole_id, { energized: data.energized, event: data.event, ts: data.ts });
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

    ws.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(connectWs, 3000);
    };

    ws.onerror = () => setWsStatus('disconnected');
  }, [addToast, fetchStats, fetchTickets]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchTickets();
    fetchStats();
    connectWs();

    const statsInterval  = setInterval(fetchStats, 10_000);
    const ticketInterval = setInterval(fetchTickets, 30_000);

    return () => {
      clearInterval(statsInterval);
      clearInterval(ticketInterval);
      wsRef.current?.close();
    };
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

      {/* Toast container */}
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
