import { useState, useEffect } from 'react';

export default function SimulatorPanel({ simStatus, onAddToast, apiBase }) {
  const [targets, setTargets] = useState({ dts: [], feeders: [], span_targets: [] });
  const [faultType, setFaultType] = useState('span');
  const [targetId, setTargetId] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTarget, setActiveTarget] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/api/simulate/targets`)
      .then((r) => r.json())
      .then((d) => {
        setTargets(d);
        if (d.span_targets?.[0]) setTargetId(d.span_targets[0].pole_id);
      })
      .catch(() => {});
  }, [apiBase]);

  const handleTypeChange = (type) => {
    setFaultType(type);
    setTargetId(
      type === 'span'   ? targets.span_targets[0]?.pole_id   || '' :
      type === 'dt'     ? targets.dts[0]?.dt_id               || '' :
      type === 'feeder' ? targets.feeders[0]?.feeder_id        || '' :
      '',
    );
  };

  const injectFault = async () => {
    if (!targetId) return onAddToast('Please select a target', 'warning');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/simulate/fault`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: faultType, target_id: targetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setActiveTarget({ type: faultType, id: targetId });
      onAddToast(`⚡ Fault injected on ${targetId} — ticket arriving in ~5s`, 'warning');
    } catch (err) {
      onAddToast(`❌ ${err.message}`, 'danger');
    }
    setLoading(false);
  };

  const repairFault = async () => {
    if (!activeTarget) return onAddToast('No active simulation to repair', 'warning');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/simulate/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: activeTarget.type, target_id: activeTarget.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAddToast('🔧 Power restoration telemetry sent — ticket auto-verifying...', 'success');
      setActiveTarget(null);
    } catch (err) {
      onAddToast(`❌ ${err.message}`, 'danger');
    }
    setLoading(false);
  };

  const injectNoise = async () => {
    const noisePoles = targets.span_targets;
    if (!noisePoles.length) return;
    const pole = noisePoles[Math.floor(Math.random() * noisePoles.length)];
    try {
      const res = await fetch(`${apiBase}/api/simulate/noise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: pole.pole_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAddToast(`📵 Device failure simulated on ${pole.pole_id} — classified as sensor failure`, 'info');
    } catch (err) {
      onAddToast(`❌ ${err.message}`, 'danger');
    }
  };

  const currentTargets =
    faultType === 'span'   ? targets.span_targets.map((t) => ({ id: t.pole_id, label: `${t.pole_id} (${t.child_count} children)` })) :
    faultType === 'dt'     ? targets.dts.map((t)  => ({ id: t.dt_id,     label: `DT ${t.dt_id} (${t.pole_count} poles)` })) :
    faultType === 'feeder' ? targets.feeders.map((t) => ({ id: t.feeder_id, label: `${t.feeder_id} (${t.dt_count} DTs)` })) :
    [];

  return (
    <div className="sim-panel">
      <div className="sim-panel__header">
        <span className="sim-bolt">⚡</span>
        <span className="sim-panel__label">SIMULATION DOCK</span>
      </div>

      <div className="sim-controls">
        {/* Fault type */}
        <select
          id="sim-fault-type"
          className="sim-select"
          value={faultType}
          onChange={(e) => handleTypeChange(e.target.value)}
        >
          <option value="span">Span Wire Break</option>
          <option value="dt">DT Transformer Outage</option>
          <option value="feeder">11kV Feeder Line Trip</option>
        </select>

        {/* Target */}
        <select
          id="sim-target"
          className="sim-select sim-select--target"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        >
          {currentTargets.length === 0 ? (
            <option value="">Loading targets...</option>
          ) : (
            currentTargets.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))
          )}
        </select>

        {/* Action Buttons */}
        <button
          id="btn-inject-fault"
          className="btn btn--danger btn--sm"
          onClick={injectFault}
          disabled={loading}
        >
          💥 Inject Fault
        </button>

        <button
          id="btn-repair-fault"
          className="btn btn--success btn--sm"
          onClick={repairFault}
          disabled={loading || !activeTarget}
        >
          🔧 Repair Lines
        </button>

        <button
          id="btn-inject-noise"
          className="btn btn--ghost btn--sm"
          onClick={injectNoise}
          disabled={loading}
          title="Simulate dead telemetry modem without grid fault"
        >
          📵 Dead Sensor
        </button>
      </div>

      {simStatus && (
        <span className="sim-status sim-status--active">{simStatus}</span>
      )}
    </div>
  );
}
