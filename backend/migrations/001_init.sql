-- KSPDB Fault Detection System — Database Schema
-- Run order matters: feeders → transformers → poles → rest

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Network topology tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE substations (
  substation_id VARCHAR(20) PRIMARY KEY,
  name          VARCHAR(60),
  lat           DECIMAL(10,7) NOT NULL,
  lon           DECIMAL(10,7) NOT NULL
);

CREATE TABLE feeders (
  feeder_id      VARCHAR(20) PRIMARY KEY,
  substation_id  VARCHAR(20) REFERENCES substations(substation_id),
  name           VARCHAR(60)
);

CREATE TABLE transformers (
  dt_id             VARCHAR(20) PRIMARY KEY,
  feeder_id         VARCHAR(20) NOT NULL REFERENCES feeders(feeder_id),
  lat               DECIMAL(10,7) NOT NULL,
  lon               DECIMAL(10,7) NOT NULL,
  capacity_kva      INTEGER,
  households_served INTEGER,
  topology_known    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE poles (
  pole_id         VARCHAR(20) PRIMARY KEY,
  lat             DECIMAL(10,7)  NOT NULL,
  lon             DECIMAL(10,7)  NOT NULL,
  feeder_id       VARCHAR(20)    NOT NULL REFERENCES feeders(feeder_id),
  dt_id           VARCHAR(20)    NOT NULL REFERENCES transformers(dt_id),
  seq_on_line     INTEGER,
  parent_pole_id  VARCHAR(20)    REFERENCES poles(pole_id),
  pole_type       VARCHAR(30),
  ward            VARCHAR(20),
  pincode         VARCHAR(10),
  device_id       VARCHAR(40),
  fw_version      VARCHAR(10),
  topology_known  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_poles_dt_id     ON poles(dt_id);
CREATE INDEX idx_poles_feeder_id ON poles(feeder_id);
CREATE INDEX idx_poles_parent    ON poles(parent_pole_id);
CREATE INDEX idx_poles_device_id ON poles(device_id);
CREATE INDEX idx_poles_latlon    ON poles(lat, lon);

-- ─────────────────────────────────────────────────────────────────────────────
-- Real-time state table — one row per pole, updated on each telemetry event
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE pole_states (
  pole_id       VARCHAR(20) PRIMARY KEY REFERENCES poles(pole_id),
  energized     BOOLEAN      NOT NULL DEFAULT true,
  last_seen     TIMESTAMPTZ,
  last_event    VARCHAR(20),
  last_seq      INTEGER      NOT NULL DEFAULT 0,
  first_dark_at TIMESTAMPTZ,          -- when we first saw this pole go dark
  restored_at   TIMESTAMPTZ,          -- when we last saw it come back
  fw_version    VARCHAR(10)
);

CREATE INDEX idx_pole_states_energized ON pole_states(energized);

-- ─────────────────────────────────────────────────────────────────────────────
-- Raw telemetry log — written by ingest worker, used for dedup
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE telemetry_events (
  id          BIGSERIAL PRIMARY KEY,
  device_id   VARCHAR(40),
  pole_id     VARCHAR(20),
  event       VARCHAR(20),
  energized   BOOLEAN,
  ts          TIMESTAMPTZ,
  seq         INTEGER,
  battery_mv  INTEGER,
  rssi        INTEGER,
  fw          VARCHAR(10),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telemetry_pole_seq ON telemetry_events(pole_id, seq);
CREATE INDEX idx_telemetry_received ON telemetry_events(received_at);

-- Per-device sequence tracking for deduplication
CREATE TABLE device_seq (
  device_id  VARCHAR(40) PRIMARY KEY,
  last_seq   INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Fault tickets
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE fault_tickets (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  status             VARCHAR(20) NOT NULL DEFAULT 'detected',
  -- detected | acknowledged | crew_assigned | resolved | verified | closed | suppressed

  fault_type         VARCHAR(20),
  -- span | dt | feeder | sensor_failure

  -- For span faults
  span_from_pole_id  VARCHAR(20) REFERENCES poles(pole_id),
  span_to_pole_id    VARCHAR(20) REFERENCES poles(pole_id),

  -- For DT / feeder faults
  dt_id              VARCHAR(20) REFERENCES transformers(dt_id),
  feeder_id          VARCHAR(20) REFERENCES feeders(feeder_id),

  -- Location for dispatch
  lat                DECIMAL(10,7),
  lon                DECIMAL(10,7),
  pincode            VARCHAR(10),

  -- Impact
  affected_pole_count   INTEGER,
  affected_households   INTEGER,

  -- Confidence
  confidence            DECIMAL(4,3),  -- 0.000–1.000
  confidence_reason     TEXT,
  topology_inferred     BOOLEAN NOT NULL DEFAULT false,

  -- AI narrative
  ai_summary            TEXT,

  -- Lifecycle timestamps
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at  TIMESTAMPTZ,
  crew_assigned_at TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  verified_at      TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,

  notes            TEXT,

  -- Dedup: one open ticket per fault boundary
  boundary_key     VARCHAR(60) UNIQUE  -- e.g. "P-001_P-002" or "DT-D-0112"
);

CREATE INDEX idx_tickets_status   ON fault_tickets(status);
CREATE INDEX idx_tickets_detected ON fault_tickets(detected_at);

-- Poles affected by a ticket
CREATE TABLE ticket_poles (
  ticket_id UUID        NOT NULL REFERENCES fault_tickets(id) ON DELETE CASCADE,
  pole_id   VARCHAR(20) NOT NULL REFERENCES poles(pole_id),
  PRIMARY KEY (ticket_id, pole_id)
);

CREATE INDEX idx_ticket_poles_ticket ON ticket_poles(ticket_id);
CREATE INDEX idx_ticket_poles_pole   ON ticket_poles(pole_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Scheduled outages (mocked feed)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE scheduled_outages (
  id         VARCHAR(30) PRIMARY KEY,
  scope      VARCHAR(10)  NOT NULL,   -- feeder | dt
  target_id  VARCHAR(20)  NOT NULL,
  start_time TIMESTAMPTZ  NOT NULL,
  end_time   TIMESTAMPTZ  NOT NULL,
  reason     TEXT,
  cancelled  BOOLEAN      NOT NULL DEFAULT false
);

CREATE INDEX idx_outages_scope_target ON scheduled_outages(scope, target_id);
CREATE INDEX idx_outages_time         ON scheduled_outages(start_time, end_time);

-- ─────────────────────────────────────────────────────────────────────────────
-- System event log (for operator audit trail)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE system_events (
  id         BIGSERIAL PRIMARY KEY,
  ticket_id  UUID,
  event_type VARCHAR(40),
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
