import { ShieldAlert, CheckCircle2, Sparkles, MapPin, AlertCircle } from 'lucide-react';

export default function FaultsPanel({ faults = [], onSelectFault, onAskAi }) {
  const activeCount = faults.length;

  return (
    <div className="panel">
      <div className="panel__header">
        <div className="panel__title-group">
          <ShieldAlert style={{ width: 18, height: 18, color: '#ef4444' }} />
          <h3 className="panel__title">Active Localized Faults</h3>
        </div>
        <span className="panel__badge">{activeCount} Active</span>
      </div>

      {activeCount === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon-container">
            <CheckCircle2 style={{ width: 28, height: 28 }} />
          </div>
          <h4 className="empty-state__title">No active grid faults detected</h4>
          <p className="empty-state__desc">
            All power feeder spans and transformers are operating nominally.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {faults.map((fault, index) => (
            <div key={fault.id || index} className="fault-card" onClick={() => onSelectFault?.(fault)}>
              <div className="fault-card__header">
                <div className="fault-card__span">
                  <AlertCircle style={{ width: 16, height: 16 }} />
                  <span>Failed Span: {fault.span_from || fault.upstream_pole_id || 'Feeder'} ➔ {fault.span_to || fault.downstream_pole_id}</span>
                </div>
                <span className="confidence-chip">
                  {Math.round((fault.confidence ?? 0.95) * 100)}% Confidence
                </span>
              </div>

              <p className="fault-card__reason">{fault.reason || fault.description}</p>

              <div className="fault-card__meta">
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin style={{ width: 12, height: 12 }} /> PIN {fault.pincode || fault.pin_code || '500032'}
                </span>
                <span>{fault.poles_affected || fault.affected_poles?.length || 0} Affected Pole(s)</span>
              </div>

              {onAskAi && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskAi(fault);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    alignSelf: 'flex-start',
                    padding: '6px 12px',
                    borderRadius: 6,
                    backgroundColor: 'var(--clr-brand-light)',
                    color: 'var(--clr-brand)',
                    border: 'none',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: 4,
                  }}
                >
                  <Sparkles style={{ width: 14, height: 14 }} />
                  <span>Ask AI Assistant</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
