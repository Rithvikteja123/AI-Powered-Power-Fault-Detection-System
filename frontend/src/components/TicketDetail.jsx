import { useState, useEffect } from 'react';

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const STATUS_FLOW = {
  detected:      ['acknowledged'],
  acknowledged:  ['crew_assigned'],
  crew_assigned: ['resolved'],
  resolved:      ['closed'],
  verified:      ['closed'],
  closed:        [],
};

const STATUS_LABELS = {
  detected:      '🔴 Detected',
  acknowledged:  '👁 Acknowledge',
  crew_assigned: '🚐 Assign Crew',
  resolved:      '🔧 Mark Resolved',
  verified:      '✅ Verified',
  closed:        '🔒 Close / Archive Ticket',
};

export default function TicketDetail({ ticket, onClose, onStatusUpdate, apiBase }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticket) { setDetail(null); return; }
    setLoading(true);
    fetch(`${apiBase}/api/tickets/${ticket.id}`)
      .then((r) => r.json())
      .then((d) => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticket, apiBase]);

  if (!ticket) return <div className="detail-panel" />;

  const conf = Math.round((ticket.confidence || 0) * 100);
  const nextStatuses = STATUS_FLOW[ticket.status] || [];

  const openInMaps = () => {
    if (ticket.lat && ticket.lon) {
      window.open(`https://www.google.com/maps?q=${ticket.lat},${ticket.lon}`, '_blank');
    }
  };

  return (
    <div className={`detail-panel ${ticket ? 'open' : ''}`}>
      <div className="detail-panel__header">
        <div>
          <div style={{ fontSize: 11, color: 'var(--txt-muted)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>
            Fault Ticket
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {ticket.fault_type?.toUpperCase()} — {STATUS_LABELS[ticket.status]}
          </div>
        </div>
        <button className="detail-panel__close" onClick={onClose} id="close-detail-btn">✕</button>
      </div>

      <div className="detail-panel__body">
        {/* Resolved banner */}
        {(ticket.status === 'resolved' || ticket.status === 'verified' || ticket.status === 'closed') && (
          <div style={{
            background: 'rgba(16,185,129,0.15)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: 'var(--space-4)',
            color: 'var(--txt-success)',
            fontWeight: 600,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span>✅</span>
            <span>FAULT RESOLVED — POWER RESTORED</span>
          </div>
        )}

        {/* AI Summary */}
        {ticket.ai_summary && (
          <div className="detail-section">
            <div className="detail-section__label">AI Summary</div>
            <div className="ai-summary-box">{ticket.ai_summary}</div>
          </div>
        )}

        {/* Topology warning */}
        {ticket.topology_inferred && (
          <div className="topo-warning mb-3">
            ⚠ Topology inferred from GPS — wiring diagram unavailable for this DT. Fault location is estimated.
          </div>
        )}

        {/* Location */}
        <div className="detail-section">
          <div className="detail-section__label">Location</div>
          {[
            ['Fault span from', ticket.span_from_pole_id || '—'],
            ['Fault span to',   ticket.span_to_pole_id   || ticket.dt_id || ticket.feeder_id || '—'],
            ['Coordinates',     ticket.lat ? `${Number(ticket.lat).toFixed(5)}° N, ${Number(ticket.lon).toFixed(5)}° E` : '—'],
            ['PIN code',        ticket.pincode || '—'],
            ['Feeder',          ticket.feeder_id || '—'],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-row__key">{k}</span>
              <span className="detail-row__value">{v}</span>
            </div>
          ))}
        </div>

        {/* Impact */}
        <div className="detail-section">
          <div className="detail-section__label">Impact</div>
          {[
            ['Poles affected',      ticket.affected_pole_count || '—'],
            ['Est. households',     ticket.affected_households || '—'],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-row__key">{k}</span>
              <span className="detail-row__value">{v}</span>
            </div>
          ))}
        </div>

        {/* Confidence */}
        <div className="detail-section">
          <div className="detail-section__label">Confidence</div>
          <div className="flex items-center gap-3 mt-2">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: conf >= 80 ? 'var(--clr-live)' : conf >= 55 ? 'var(--clr-suspect)' : 'var(--clr-dark)' }}>
              {conf}%
            </span>
          </div>
          <div className="confidence-bar mt-2">
            <div className="confidence-bar__fill" style={{ width: `${conf}%` }} />
          </div>
          {ticket.confidence_reason && (
            <div style={{ fontSize: 11, color: 'var(--txt-muted)', marginTop: 6, lineHeight: 1.5 }}>
              {ticket.confidence_reason}
            </div>
          )}
        </div>

        {/* Actions */}
        {nextStatuses.length > 0 && (
          <div className="detail-section">
            <div className="detail-section__label">Actions</div>
            <div className="action-row">
              {nextStatuses.map((s) => (
                <button
                  key={s}
                  id={`btn-status-${s}`}
                  className={`btn btn--${s === 'resolved' ? 'success' : s === 'crew_assigned' ? 'primary' : 'ghost'}`}
                  onClick={() => onStatusUpdate(ticket.id, s)}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
              <button className="btn btn--ghost" onClick={openInMaps} id="btn-open-maps">
                🗺 Navigate
              </button>
            </div>
          </div>
        )}

        {/* Affected poles */}
        {detail?.poles && (
          <div className="detail-section">
            <div className="detail-section__label">
              Affected Poles ({detail.poles.length})
            </div>
            <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 11 }}>
              {detail.poles.map((p) => (
                <div key={p.pole_id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '3px 0', borderBottom: '1px solid var(--border)',
                }}>
                  <span className="mono" style={{ color: 'var(--txt-secondary)' }}>{p.pole_id}</span>
                  <span className={`badge badge--${p.energized === false ? 'danger' : 'success'}`}>
                    {p.energized === false ? '🔴 Dark' : '🟢 Live'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="detail-section">
          <div className="detail-section__label">Timeline</div>
          <div className="timeline">
            {[
              ['Detected',      ticket.detected_at],
              ['Acknowledged',  ticket.acknowledged_at],
              ['Crew assigned', ticket.crew_assigned_at],
              ['Resolved',      ticket.resolved_at],
              ['Verified',      ticket.verified_at],
              ['Closed',        ticket.closed_at],
            ].filter(([, ts]) => ts).map(([label, ts]) => (
              <div key={label} className="timeline-event">
                <div className="timeline-event__label">{label}</div>
                <div className="timeline-event__time">{fmt(ts)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Ticket ID */}
        <div style={{ fontSize: 10, color: 'var(--txt-muted)', fontFamily: 'var(--font-mono)', marginTop: 8 }}>
          {ticket.id}
        </div>
      </div>
    </div>
  );
}
