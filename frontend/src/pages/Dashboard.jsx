import { useState, useEffect } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import StatsRow from '../components/StatsRow.jsx';
import FaultsPanel from '../components/FaultsPanel.jsx';
import TicketsPanel from '../components/TicketsPanel.jsx';
import SimulatorModal from '../components/SimulatorModal.jsx';
import TicketDetail from '../components/TicketDetail.jsx';
import MapView from '../components/MapView.jsx';
import SimulatorPanel from '../components/SimulatorPanel.jsx';
import { RefreshCw, Sparkles, Map, FlaskConical } from 'lucide-react';

export default function Dashboard({
  tickets,
  stats,
  poleStates,
  wsStatus,
  simStatus,
  theme,
  onToggleTheme,
  onTicketsChange,
  onAddToast,
  apiBase,
}) {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [isInjectModalOpen, setIsInjectModalOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Extract faults from tickets
  const activeFaults = tickets
    .filter(t => t.status !== 'CLOSED')
    .map(t => ({
      id: t.id,
      span_from: t.span_from || t.upstream_pole_id || 'Feeder',
      span_to: t.span_to || t.downstream_pole_id || t.pole_id,
      pincode: t.pincode || t.pin_code || '500032',
      confidence: t.confidence ?? 0.95,
      reason: t.description || `Failed span detected between ${t.span_from || 'P2'} and ${t.span_to || 'P3'}.`,
      poles_affected: t.poles_affected || 3,
    }));

  const handleRefresh = () => {
    onTicketsChange();
    onAddToast('🔄 Grid status refreshed', 'info');
  };

  const handleAskAi = async (fault) => {
    setAiLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: fault.id }),
      });
      const data = await res.json();
      setAiSummary(data.explanation || data.summary || 'Fault detected due to downstream loss of telemetry pings on 3 consecutive poles.');
    } catch (e) {
      setAiSummary('AI Assistant: Fault localized via graph traversal algorithm. Downstream poles P3, P4, P5 lost power simultaneously while parent pole P2 remains energized.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="app-layout">
      {/* Left Sidebar */}
      <Sidebar
        activeNav={activeNav}
        onNavSelect={setActiveNav}
        theme={theme}
        onToggleTheme={onToggleTheme}
        wsStatus={wsStatus}
      />

      {/* Main Wrapper */}
      <div className="main-wrapper">
        {/* Top Bar */}
        <TopBar onInjectClick={() => setIsInjectModalOpen(true)} />

        {/* Dashboard Scrollable Body */}
        <main className="dashboard-content">
          {/* Header Banner */}
          <div className="dashboard-header">
            <div>
              <h1 className="dashboard-header__title">Operator Dashboard</h1>
              <p className="dashboard-header__subtitle">
                Real-time power distribution network status and telemetry
              </p>
            </div>
            <button className="refresh-btn" onClick={handleRefresh}>
              <RefreshCw style={{ width: 14, height: 14 }} />
              <span>Refresh</span>
            </button>
          </div>

          {/* 4 Stat Cards */}
          <StatsRow stats={stats} />

          {/* Render Active View based on Navigation */}
          {activeNav === 'dashboard' && (
            <div className="panels-grid">
              {/* Left Panel: Active Localized Faults */}
              <FaultsPanel
                faults={activeFaults}
                onSelectFault={(f) => {
                  const t = tickets.find(x => x.id === f.id);
                  if (t) setSelectedTicket(t);
                }}
                onAskAi={handleAskAi}
              />

              {/* Right Panel: Incident Tickets */}
              <TicketsPanel
                tickets={tickets}
                selectedId={selectedTicket?.id}
                onSelectTicket={setSelectedTicket}
              />
            </div>
          )}

          {activeNav === 'map' && (
            <div className="panel" style={{ height: '560px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div className="panel__header">
                <div className="panel__title-group">
                  <Map style={{ width: 18, height: 18, color: '#2563eb' }} />
                  <h3 className="panel__title">Live Grid Topology Map</h3>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, position: 'relative', width: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <MapView
                  tickets={tickets}
                  poleStates={poleStates}
                  selectedTicket={selectedTicket}
                  onTicketSelect={setSelectedTicket}
                  apiBase={apiBase}
                />
              </div>
            </div>
          )}

          {activeNav === 'simulator' && (
            <div className="panel">
              <div className="panel__header">
                <div className="panel__title-group">
                  <FlaskConical style={{ width: 18, height: 18, color: '#f59e0b' }} />
                  <h3 className="panel__title">Fault Simulator Control Panel</h3>
                </div>
              </div>
              <SimulatorPanel
                simStatus={simStatus}
                onAddToast={onAddToast}
                apiBase={apiBase}
              />
            </div>
          )}

          {activeNav === 'telemetry' && (
            <div className="panel">
              <div className="panel__header">
                <h3 className="panel__title">Live IoT Telemetry Feed</h3>
              </div>
              <p style={{ color: 'var(--txt-muted)', fontSize: 13 }}>
                Listening to real-time WebSocket telemetry stream... ({poleStates.size} active poles reporting)
              </p>
            </div>
          )}

          {activeNav === 'settings' && (
            <div className="panel">
              <div className="panel__header">
                <h3 className="panel__title">System Settings & AI Assistant Config</h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: 'var(--txt-secondary)' }}>
                <p>• Telemetry Staleness Threshold: 5 minutes (300,000 ms)</p>
                <p>• Deduplication Window: 30 seconds (30,000 ms)</p>
                <p>• AI Service Provider: OpenAI GPT-4 with Template-based Fallback</p>
                <p>• Current Theme Mode: <strong style={{ textTransform: 'capitalize' }}>{theme} Mode</strong></p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Ticket Detail Drawer */}
      <TicketDetail
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onStatusUpdate={async (ticketId, newStatus) => {
          try {
            const res = await fetch(`${apiBase}/api/tickets/${ticketId}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: newStatus }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Update failed');
            onAddToast(`Ticket updated to "${newStatus}"`, 'success');
            onTicketsChange();
            setSelectedTicket((t) => t ? { ...t, ...data } : t);
          } catch (err) {
            onAddToast(`❌ ${err.message}`, 'danger');
          }
        }}
        apiBase={apiBase}
      />

      {/* Quick Inject Fault Modal */}
      <SimulatorModal
        isOpen={isInjectModalOpen}
        onClose={() => setIsInjectModalOpen(false)}
        onAddToast={onAddToast}
        apiBase={apiBase}
      />

      {/* AI Explanation Drawer Modal */}
      {aiSummary && (
        <div className="modal-overlay" onClick={() => setAiSummary(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles style={{ width: 20, height: 20, color: '#2563eb' }} />
                <h3 className="modal-title">AI Incident Assistant Explanation</h3>
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'var(--txt-secondary)', lineHeight: 1.6 }}>
              {aiSummary}
            </p>
            <button
              className="inject-btn"
              onClick={() => setAiSummary(null)}
              style={{ alignSelf: 'flex-end', backgroundColor: '#2563eb' }}
            >
              Close Summary
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
