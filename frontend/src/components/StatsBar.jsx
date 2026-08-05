import { useEffect, useState } from 'react';

export default function StatsBar({ stats, wsStatus }) {
  const [clock, setClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeFaults = stats.active_tickets ?? 0;
  const darkPoles    = stats.poles_affected ?? 0;
  const households   = stats.households_affected ?? 0;
  const resolved24h  = stats.closed_24h ?? 0;

  return (
    <header className="topbar">
      {/* Brand & Logo */}
      <div className="topbar__logo">
        <span className="bolt">⚡</span>
        <span className="brand-text">
          <span className="brand-title">KSPDB</span>
          <span className="brand-sub">Grid Control Room</span>
        </span>
      </div>

      <div className="topbar__divider" />

      {/* Live Metric Cards */}
      <div className="topbar__stats">
        <div className={`stat-card ${activeFaults > 0 ? 'stat-card--critical' : 'stat-card--neutral'}`}>
          <span className="stat-card__label">Active Faults</span>
          <span className="stat-card__value">{activeFaults}</span>
        </div>

        <div className={`stat-card ${darkPoles > 0 ? 'stat-card--warning' : 'stat-card--neutral'}`}>
          <span className="stat-card__label">Poles Dark</span>
          <span className="stat-card__value">{darkPoles}</span>
        </div>

        <div className="stat-card stat-card--info">
          <span className="stat-card__label">Households Affected</span>
          <span className="stat-card__value">{households.toLocaleString()}</span>
        </div>

        <div className="stat-card stat-card--success">
          <span className="stat-card__label">Resolved (24h)</span>
          <span className="stat-card__value">{resolved24h}</span>
        </div>
      </div>

      {/* Connection & Live Clock */}
      <div className="topbar__right">
        <div className={`ws-badge ws-badge--${wsStatus}`}>
          <span className={`ws-dot ws-dot--${wsStatus}`} />
          <span className="ws-text">
            {wsStatus === 'connected' ? 'LIVE TELEMETRY' : wsStatus === 'connecting' ? 'CONNECTING...' : 'OFFLINE'}
          </span>
        </div>

        <div className="topbar__divider" style={{ height: 20 }} />

        <div className="topbar__time">
          <span>{clock.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' })}</span>
          <span className="time-sep">·</span>
          <span className="time-clock">{clock.toLocaleTimeString('en-IN', { hour12: false })}</span>
        </div>
      </div>
    </header>
  );
}
