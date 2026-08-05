import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

const BENGALURU_CENTER = [13.0150, 77.5500];
const DEFAULT_ZOOM   = 12;

function poleColor(p, isAffected) {
  if (!p.device_id) return '#475569'; // Undeviced poles have no telemetry -> Grey
  if (isAffected && (p.energized === false || p.energized === 0)) return '#ef4444';   // bright red — confirmed dark
  if (p.energized === false || p.energized === 0)               return '#f97316';   // orange — dark pole
  if (p.energized === true  || p.energized === 1)                return '#22c55e';   // green — live pole
  return '#475569';                                          // grey — no telemetry
}

function FaultIcon(type) {
  const color = type === 'feeder' ? '#a855f7' : type === 'dt' ? '#f59e0b' : '#ef4444';
  return L.divIcon({
    className: 'custom-fault-icon',
    html: `<div style="
      width:32px;height:32px;
      background:${color};
      border:2.5px solid #ffffff;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:15px;
      box-shadow:0 0 16px ${color}, 0 0 0 6px ${color}33;
      animation: pulseGlow 1.8s ease-in-out infinite;
    ">⚡</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function MapController({ selectedTicket, centerTrigger }) {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedTicket, map]);

  useEffect(() => {
    if (selectedTicket?.lat && selectedTicket?.lon) {
      map.flyTo([selectedTicket.lat, selectedTicket.lon], 16, { duration: 1.2 });
    }
  }, [selectedTicket, map]);

  useEffect(() => {
    if (centerTrigger > 0) {
      map.flyTo(BENGALURU_CENTER, DEFAULT_ZOOM, { duration: 1.0 });
    }
  }, [centerTrigger, map]);

  return null;
}

export default function MapView({ tickets, poleStates, selectedTicket, onTicketSelect, apiBase }) {
  const [poles, setPoles] = useState([]);
  const [showFaultsOnly, setShowFaultsOnly] = useState(false);
  const [centerTrigger, setCenterTrigger] = useState(0);

  useEffect(() => {
    fetch(`${apiBase}/api/poles?limit=6000`)
      .then((r) => r.json())
      .then((d) => setPoles(d.poles || []))
      .catch(() => {});
  }, [apiBase]);

  // Only active (unresolved) tickets get highlighted on the map
  const activeTickets = tickets.filter(
    (t) => t.status !== 'resolved' && t.status !== 'verified' && t.status !== 'closed',
  );

  const affectedPoleIds = new Set(
    activeTickets.flatMap((t) => [t.span_from_pole_id, t.span_to_pole_id].filter(Boolean)),
  );

  const poleList = poles.map((p) => {
    const liveState = poleStates.get(p.pole_id);
    return {
      ...p,
      energized: liveState ? liveState.energized : p.energized,
    };
  });

  const renderablePoles = poleList
    .filter((p) => p.device_id || p.energized !== undefined)
    .filter((p) => !showFaultsOnly || p.energized === false || affectedPoleIds.has(p.pole_id));

  return (
    <div className="map-wrapper">
      {/* Map Action Toolbar */}
      <div className="map-toolbar">
        <button
          className="map-tool-btn"
          onClick={() => setCenterTrigger((c) => c + 1)}
          title="Recenter Map View"
        >
          📍 Recenter Grid
        </button>

        <button
          className={`map-tool-btn ${showFaultsOnly ? 'active' : ''}`}
          onClick={() => setShowFaultsOnly((v) => !v)}
        >
          {showFaultsOnly ? '⚡ Active Faults Only' : `🌐 All Poles (${poles.length})`}
        </button>
      </div>

      <MapContainer
        center={BENGALURU_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          maxZoom={19}
        />

        <MapController selectedTicket={selectedTicket} centerTrigger={centerTrigger} />

        {/* Render pole dots */}
        {renderablePoles.map((p) => {
          const isAffected = affectedPoleIds.has(p.pole_id);
          const color = poleColor(p, isAffected);
          const radius = isAffected ? 6 : 3.5;

          return (
            <CircleMarker
              key={p.pole_id}
              center={[p.lat, p.lon]}
              radius={radius}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.9,
                weight: isAffected ? 2 : 0,
              }}
            >
              <Tooltip sticky>
                <div style={{ fontSize: 11, lineHeight: 1.6, padding: '2px 4px' }}>
                  <strong style={{ color: 'var(--txt-primary)' }}>{p.pole_id}</strong><br />
                  Status: <strong>{p.energized === false ? '🔴 Dark' : p.energized === true ? '🟢 Live' : '⬜ Unknown'}</strong><br />
                  DT: {p.dt_id || '—'} | Ward: {p.ward || '—'}<br />
                  PIN: {p.pincode || '—'}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

        {/* Render fault beacons ONLY for ACTIVE tickets */}
        {activeTickets.map((t) => {
          if (!t.lat || !t.lon) return null;
          const isSelected = selectedTicket?.id === t.id;

          return (
            <Marker
              key={t.id}
              position={[t.lat, t.lon]}
              icon={FaultIcon(t.fault_type)}
              eventHandlers={{ click: () => onTicketSelect(t) }}
              zIndexOffset={isSelected ? 1000 : 500}
            >
              <Tooltip direction="top" offset={[0, -16]} permanent={isSelected}>
                <div style={{ fontSize: 11, fontWeight: 600 }}>
                  ⚡ {t.fault_type?.toUpperCase()} Fault ({t.affected_pole_count} poles)
                </div>
              </Tooltip>
            </Marker>
          );
        })}

        {/* Span lines ONLY for ACTIVE tickets */}
        {activeTickets
          .filter((t) => t.fault_type === 'span')
          .map((t) => {
            const fromPole = poles.find((p) => p.pole_id === t.span_from_pole_id);
            const toPole   = poles.find((p) => p.pole_id === t.span_to_pole_id);
            if (!fromPole || !toPole) return null;
            return (
              <Polyline
                key={`span-${t.id}`}
                positions={[[fromPole.lat, fromPole.lon], [toPole.lat, toPole.lon]]}
                pathOptions={{ color: '#ef4444', weight: 4, dashArray: '6 4', opacity: 0.95 }}
              />
            );
          })}
      </MapContainer>

      {/* Map Legend */}
      <div className="map-legend">
        <div className="legend-title">Grid Legend</div>
        {[
          ['#22c55e', 'Live pole'],
          ['#ef4444', 'Dark pole (fault span)'],
          ['#f97316', 'Dark pole'],
          ['#475569', 'No telemetry'],
          ['#f59e0b', 'DT transformer fault ⚡'],
          ['#a855f7', 'Feeder line fault ⚡'],
        ].map(([color, label]) => (
          <div key={label} className="legend-item">
            <div className="legend-dot" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
