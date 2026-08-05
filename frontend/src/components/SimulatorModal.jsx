import { useState, useEffect } from 'react';
import { X, Zap, Wrench, AlertTriangle, ShieldAlert } from 'lucide-react';

export default function SimulatorModal({ isOpen, onClose, onAddToast, apiBase }) {
  const [targets, setTargets] = useState({ dts: [], feeders: [], span_targets: [] });
  const [faultType, setFaultType] = useState('span');
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch(`${apiBase}/api/simulate/targets`)
        .then(r => r.json())
        .then(d => {
          setTargets(d);
          if (d.span_targets?.[0]) {
            setTargetId(d.span_targets[0].pole_id);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, apiBase]);

  if (!isOpen) return null;

  const handleInject = async () => {
    if (!targetId) return onAddToast('Please select a target', 'warning');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/simulate/fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: faultType, target_id: targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fault injection failed');
      onAddToast(`⚡ Fault injected on ${targetId} — ticket arriving in ~5s`, 'warning');
      onClose();
    } catch (err) {
      onAddToast(`❌ ${err.message}`, 'danger');
    } finally {
      setLoading(false);
    }
  };

  const handleRepair = async () => {
    if (!targetId) return onAddToast('Please select a target to repair', 'warning');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/simulate/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: faultType, target_id: targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Power restoration failed');
      onAddToast('🔧 Power restoration telemetry sent — ticket auto-verifying...', 'success');
      onClose();
    } catch (err) {
      onAddToast(`❌ ${err.message}`, 'danger');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap style={{ width: 18, height: 18, fill: 'currentColor' }} />
            </div>
            <div>
              <h3 className="modal-title">Inject Network Fault</h3>
              <p style={{ fontSize: 12, color: 'var(--txt-muted)' }}>Simulate IoT telemetry events and power outages</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`nav-item ${faultType === 'span' ? 'nav-item--active' : ''}`}
              onClick={() => {
                setFaultType('span');
                if (targets.span_targets?.[0]) setTargetId(targets.span_targets[0].pole_id);
              }}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <AlertTriangle style={{ width: 14, height: 14 }} /> Span Fault
            </button>

            <button
              className={`nav-item ${faultType === 'dt' ? 'nav-item--active' : ''}`}
              onClick={() => {
                setFaultType('dt');
                if (targets.dts?.[0]) setTargetId(targets.dts[0].dt_id);
              }}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              <ShieldAlert style={{ width: 14, height: 14 }} /> DT Fault
            </button>
          </div>

          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt-primary)' }}>
            Target ID ({faultType.toUpperCase()}):
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 8,
                marginTop: 6,
                backgroundColor: 'var(--bg-elevated)',
                color: 'var(--txt-primary)',
                border: '1px solid var(--border-color)',
                fontSize: 13,
              }}
            >
              {faultType === 'span' && targets.span_targets?.map(t => (
                <option key={t.pole_id} value={t.pole_id}>
                  Pole {t.pole_id} (Pincode: {t.pincode || '560040'})
                </option>
              ))}

              {faultType === 'dt' && targets.dts?.map(t => (
                <option key={t.dt_id} value={t.dt_id}>
                  DT {t.dt_id} ({t.name || 'Distribution Transformer'})
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
            <button
              className="inject-btn"
              disabled={loading}
              onClick={handleInject}
              style={{ justifyContent: 'center', backgroundColor: '#ef4444' }}
            >
              <Zap style={{ width: 14, height: 14, fill: 'currentColor' }} />
              Inject Fault
            </button>

            <button
              className="inject-btn"
              disabled={loading}
              onClick={handleRepair}
              style={{ justifyContent: 'center', backgroundColor: '#10b981' }}
            >
              <Wrench style={{ width: 14, height: 14 }} />
              Restore Power
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
