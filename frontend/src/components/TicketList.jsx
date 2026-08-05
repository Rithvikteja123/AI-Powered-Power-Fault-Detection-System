import { useState } from 'react';

function timeAgo(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

const TYPE_LABELS = { span: 'Span Break', dt: 'DT Transformer', feeder: '11kV Feeder' };
const STATUS_ORDER = { detected: 0, acknowledged: 1, crew_assigned: 2, resolved: 3, verified: 4, closed: 5 };

function TicketCard({ ticket, isActive, onClick }) {
  const typeLabel = TYPE_LABELS[ticket.fault_type] || ticket.fault_type;
  const conf = Math.round((ticket.confidence || 0) * 100);
  const isResolved = ticket.status === 'resolved' || ticket.status === 'verified' || ticket.status === 'closed';

  return (
    <div
      id={`ticket-${ticket.id}`}
      className={`ticket-card ticket-card--${ticket.status}${isActive ? ' active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="ticket-card__top">
        <span className={`ticket-card__type ticket-card__type--${ticket.fault_type}`}>
          {typeLabel}
        </span>
        <span className="ticket-card__time">{timeAgo(ticket.detected_at)}</span>
      </div>

      <div className="ticket-card__location">
        {ticket.fault_type === 'span' && ticket.span_to_pole_id
          ? `Span: ${ticket.span_from_pole_id || '?'} ➔ ${ticket.span_to_pole_id}`
          : ticket.fault_type === 'dt' && ticket.dt_id
          ? `Transformer DT ${ticket.dt_id}`
          : ticket.fault_type === 'feeder' && ticket.feeder_id
          ? `Feeder Line ${ticket.feeder_id}`
          : 'Unknown location'}
      </div>

      <div className="ticket-card__meta">
        {ticket.pincode && <span className="meta-item">📍 PIN {ticket.pincode}</span>}
        <span className="meta-item">⚡ {ticket.affected_pole_count || 0} poles</span>
        {ticket.affected_households > 0 && <span className="meta-item">🏠 {ticket.affected_households.toLocaleString()} hh</span>}
      </div>

      <div className="ticket-card__badges">
        {isResolved ? (
          <span className="badge badge--success">✅ Power Restored</span>
        ) : (
          <span className={`badge badge--${conf >= 80 ? 'success' : conf >= 55 ? 'warning' : 'danger'}`}>
            {conf}% confidence
          </span>
        )}

        {ticket.topology_inferred && (
          <span className="badge badge--warning">⚠ inferred topo</span>
        )}

        <span className={`badge badge--status badge--${ticket.status}`}>
          {ticket.status.replace('_', ' ')}
        </span>
      </div>
    </div>
  );
}

export default function TicketList({ tickets, selectedId, onSelect }) {
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState('active'); // 'active' | 'resolved' | 'all'
  const [filterType, setFilterType] = useState('all');

  const activeCount = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'verified' && t.status !== 'closed').length;
  const resolvedCount = tickets.filter((t) => t.status === 'resolved' || t.status === 'verified' || t.status === 'closed').length;

  const filtered = tickets.filter((t) => {
    // Status tab filter
    const isRes = t.status === 'resolved' || t.status === 'verified' || t.status === 'closed';
    if (statusTab === 'active' && isRes) return false;
    if (statusTab === 'resolved' && !isRes) return false;

    // Type filter
    if (filterType !== 'all' && t.fault_type !== filterType) return false;

    // Search query filter
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (t.span_to_pole_id && t.span_to_pole_id.toLowerCase().includes(q)) ||
      (t.span_from_pole_id && t.span_from_pole_id.toLowerCase().includes(q)) ||
      (t.dt_id && t.dt_id.toLowerCase().includes(q)) ||
      (t.feeder_id && t.feeder_id.toLowerCase().includes(q)) ||
      (t.pincode && t.pincode.includes(q))
    );
  });

  const sorted = [...filtered].sort(
    (a, b) => (STATUS_ORDER[a.status] || 0) - (STATUS_ORDER[b.status] || 0)
      || new Date(b.detected_at) - new Date(a.detected_at),
  );

  return (
    <>
      <div className="sidebar__header">
        <div className="flex items-center justify-between w-full mb-2">
          <span className="sidebar__title">Incidents ({tickets.length})</span>
          {activeCount > 0 && <span className="sidebar__badge">{activeCount} Unresolved</span>}
        </div>

        {/* Status Tabs: Active | Resolved | All */}
        <div className="filter-tabs mb-2" style={{ background: 'var(--bg-base)' }}>
          <button
            className={`filter-tab ${statusTab === 'active' ? 'active' : ''}`}
            onClick={() => setStatusTab('active')}
          >
            ⚡ Active ({activeCount})
          </button>
          <button
            className={`filter-tab ${statusTab === 'resolved' ? 'active' : ''}`}
            onClick={() => setStatusTab('resolved')}
          >
            ✅ Resolved ({resolvedCount})
          </button>
          <button
            className={`filter-tab ${statusTab === 'all' ? 'active' : ''}`}
            onClick={() => setStatusTab('all')}
          >
            All ({tickets.length})
          </button>
        </div>

        {/* Search & Fault Type Controls */}
        <div className="sidebar__controls">
          <input
            type="text"
            className="sidebar__search"
            placeholder="Search pole, DT, PIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="filter-tabs mt-2">
            {['all', 'span', 'dt', 'feeder'].map((ft) => (
              <button
                key={ft}
                className={`filter-tab ${filterType === ft ? 'active' : ''}`}
                onClick={() => setFilterType(ft)}
              >
                {ft === 'all' ? 'All Types' : ft.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar__list">
        {sorted.length === 0 ? (
          <div className="sidebar__empty">
            <span className="icon">🟢</span>
            <span style={{ fontWeight: 600, color: 'var(--txt-primary)' }}>
              {statusTab === 'active' ? 'No active faults' : statusTab === 'resolved' ? 'No resolved faults yet' : 'No incidents found'}
            </span>
            <span style={{ fontSize: 11, textAlign: 'center', maxWidth: 200, color: 'var(--txt-muted)' }}>
              {statusTab === 'active'
                ? 'All lines energised. Use the control dock at the bottom to inject a simulated fault.'
                : 'Resolved incidents will appear here once fixed.'}
            </span>
          </div>
        ) : (
          sorted.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              isActive={t.id === selectedId}
              onClick={() => onSelect(t)}
            />
          ))
        )}
      </div>
    </>
  );
}
