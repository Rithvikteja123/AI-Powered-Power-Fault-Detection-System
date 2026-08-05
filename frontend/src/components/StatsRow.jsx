import { Zap, CheckCircle2, AlertTriangle, Activity } from 'lucide-react';

export default function StatsRow({ stats }) {
  const totalPoles     = stats.total_poles ?? stats.poles_total ?? 100;
  const darkPoles      = stats.poles_affected ?? 0;
  const energizedPoles = stats.energized_poles ?? (totalPoles - darkPoles);
  const activeIncidents= stats.active_tickets ?? 0;
  const telemetryCount = stats.telemetry_count ?? 0;

  const energizedPercentage = totalPoles > 0
    ? Math.round((energizedPoles / totalPoles) * 100)
    : 100;

  return (
    <div className="stats-grid">
      {/* 1. Total Grid Poles */}
      <div className="stat-card">
        <div className="stat-card__header">
          <span className="stat-card__title">TOTAL GRID POLES</span>
          <Zap className="stat-card__icon stat-card__icon--blue" />
        </div>
        <div className="stat-card__value">{totalPoles}</div>
        <div className="stat-card__footer">Topology active</div>
      </div>

      {/* 2. Energized Poles */}
      <div className="stat-card">
        <div className="stat-card__header">
          <span className="stat-card__title">ENERGIZED POLES</span>
          <CheckCircle2 className="stat-card__icon stat-card__icon--green" />
        </div>
        <div className="stat-card__value">{energizedPoles}</div>
        <div className="stat-card__footer">
          {energizedPercentage}% Energized ({darkPoles} dark)
        </div>
      </div>

      {/* 3. Active Incidents */}
      <div className="stat-card">
        <div className="stat-card__header">
          <span className="stat-card__title">ACTIVE INCIDENTS</span>
          <AlertTriangle className="stat-card__icon stat-card__icon--red" />
        </div>
        <div className="stat-card__value">{activeIncidents}</div>
        <div className="stat-card__footer">
          {activeIncidents === 0 ? 'Grid Nominal' : `${activeIncidents} active ticket(s)`}
        </div>
      </div>

      {/* 4. Telemetry Ingested */}
      <div className="stat-card">
        <div className="stat-card__header">
          <span className="stat-card__title">TELEMETRY INGESTED</span>
          <Activity className="stat-card__icon stat-card__icon--amber" />
        </div>
        <div className="stat-card__value">{telemetryCount}</div>
        <div className="stat-card__footer stat-card__footer--green">
          WebSocket live feed
        </div>
      </div>
    </div>
  );
}
