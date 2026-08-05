import { CheckSquare, Ticket, ChevronRight, Clock } from 'lucide-react';

export default function TicketsPanel({ tickets = [], onSelectTicket, selectedId }) {
  const activeTickets = tickets.filter(t => t.status !== 'CLOSED');

  return (
    <div className="panel">
      <div className="panel__header">
        <div className="panel__title-group">
          <CheckSquare style={{ width: 18, height: 18, color: '#2563eb' }} />
          <h3 className="panel__title">Incident Tickets</h3>
        </div>
        <span className="panel__badge">{activeTickets.length} Logged</span>
      </div>

      {activeTickets.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon-container" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--txt-muted)' }}>
            <Ticket style={{ width: 28, height: 28 }} />
          </div>
          <h4 className="empty-state__title">No incident tickets logged</h4>
          <p className="empty-state__desc">
            System will automatically create an incident ticket when a power fault is localized.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 420 }}>
          {activeTickets.map((t) => {
            const isSelected = selectedId === t.id;
            const statusColor =
              t.status === 'VERIFIED' ? '#10b981' :
              t.status === 'RESOLVED' ? '#3b82f6' :
              t.status === 'CREW_ASSIGNED' ? '#f59e0b' : '#ef4444';

            return (
              <div
                key={t.id}
                onClick={() => onSelectTicket?.(t)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  backgroundColor: isSelected ? 'var(--clr-brand-light)' : 'var(--bg-surface)',
                  border: `1px solid ${isSelected ? 'var(--clr-brand)' : 'var(--border-card)'}`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt-primary)' }}>
                      {t.id || t.ticket_number}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: 10,
                        backgroundColor: `${statusColor}18`,
                        color: statusColor,
                        textTransform: 'uppercase',
                      }}
                    >
                      {t.status}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--txt-secondary)' }}>
                    {t.fault_type || 'SPAN_FAULT'} at PIN {t.pincode || '500032'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--txt-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock style={{ width: 10, height: 10 }} />
                    {new Date(t.created_at || Date.now()).toLocaleTimeString()}
                  </span>
                </div>
                <ChevronRight style={{ width: 16, height: 16, color: 'var(--txt-muted)' }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
