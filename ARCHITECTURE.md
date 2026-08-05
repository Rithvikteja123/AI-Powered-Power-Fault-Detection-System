# Architecture — KSPDB Fault Detection System

## Data Flow Diagram

```
                           ┌─────────────────────┐
   Pole IoT devices        │  POST /api/telemetry  │
   (NB-IoT → HTTPS) ──────►│                       │
                           │  Ring buffer (50k)    │
                           └──────────┬────────────┘
                                      │ drain every 100ms
                                      ▼
                           ┌─────────────────────────────┐
                           │     Ingest Worker            │
                           │  - Dedup via device seq      │
                           │  - Update pole_states        │
                           │  - Log to telemetry_events   │
                           └──────────┬──────────────────┘
                                      │ every 15s (cron)
                                      ▼
                           ┌─────────────────────────────┐
                           │    Localizer Engine          │
                           │                              │
                           │  For each DT:                │
                           │  1. Check scheduled outage   │
                           │  2. Build topology tree      │
                           │     (known or MST-inferred)  │
                           │  3. DFS → find live/dark     │
                           │     boundary                 │
                           │  4. Dead sensor check        │
                           │  5. Group into 1 ticket      │
                           │  6. Compute confidence       │
                           └──────────┬──────────────────┘
                                      │
                           ┌──────────▼──────────────────┐
                           │      Ticket Manager          │
                           │  - Upsert by boundary_key   │
                           │  - Check restorations        │
                           │  - Generate AI summary       │
                           └──────────┬──────────────────┘
                                      │ WebSocket broadcast
                                      ▼
                           ┌──────────────────────────────┐
                           │    Operator Console (React)  │
                           │                              │
                           │  ┌────────┐ ┌────────────┐  │
                           │  │Sidebar │ │ Leaflet Map│  │
                           │  │Tickets │ │  + Detail  │  │
                           │  └────────┘ └────────────┘  │
                           │        Simulator Panel       │
                           └──────────────────────────────┘
```

---

## Data Sourcing and Ingestion

**Transport:** Pole devices push to `POST /api/telemetry` over HTTPS. (Production uses NB-IoT → MQTT broker → bridge; the HTTPS endpoint is structurally identical.)

**Throughput design:**
- Each POST is handled in < 2ms: validate, push to in-memory ring buffer, return 202
- Background worker drains buffer every 100ms in batches of 500
- Ring buffer size: 50,000 messages — handles the 5,000-msg/10s burst requirement
- At steady state (39 msg/s) the buffer is nearly always empty

**Deduplication:**
- Sequence tracking per `device_id` in `device_seq` table
- At-least-once delivery: re-processed messages are idempotent (UPSERT on pole_states)
- Stale messages (> 6 hours old) dropped at ingest

**Clock skew:** Device `ts` is stored as-is. `first_dark_at` is set using wall clock at ingest time, not device timestamp. This means ±90s clock skew does not affect debouncing.

**Out-of-order messages:** `pole_states` stores `last_seen = GREATEST(last_seen, ts)` so an older timestamp arriving late does not reset a pole's state.

---

## Storage and Internal Model

### Schema summary

| Table | Purpose |
|-------|---------|
| `substations` | 4 substations (root of the network) |
| `feeders` | 31 × 11kV feeders |
| `transformers` | 412 DTs with lat/lon and `topology_known` flag |
| `poles` | ~5,000 poles with GPS, `parent_pole_id`, `device_id` |
| `pole_states` | One row per pole — current live/dark state |
| `telemetry_events` | Raw event log (append-only) |
| `device_seq` | Last-seen sequence per device for dedup |
| `fault_tickets` | Detected faults with lifecycle |
| `ticket_poles` | Many-to-many: ticket ↔ affected poles |
| `scheduled_outages` | Mocked planned outage feed |
| `system_events` | Audit log of ticket lifecycle events |

**Topology representation:** Adjacency list via `parent_pole_id`. Trees are built in-memory by the localizer on each pass. The `boundary_key` field (e.g. `span_P-001_P-002`) uniquely identifies a fault location and prevents duplicate tickets for the same fault.

---

## The Localization Algorithm

### Core insight

The LT network is radial (a tree). When a span fails, all downstream nodes go dark and all upstream nodes stay live. The fault is at the **edge between the last live node and the first dark node in a BFS/DFS traversal from the DT root**.

### Algorithm (per DT, every 15 seconds)

```
1. SKIP if DT or feeder is in scheduled outage window (± 40 min grace)

2. IF all deviced poles under DT are dark (debounced 25s):
   → DT-level fault ticket, confidence 0.80

3. ELSE:
   a. Build topology tree (known or MST-inferred)
   b. DFS from root poles:
      - Live node → dark child:
          i. Check dead sensor: is dark node's child live? → skip
         ii. Collect all dark descendants → one ticket
        iii. Compute confidence
         iv. Stop recursion (don't split one fault into two)
      - Both live OR both dark → recurse into children
```

**Simultaneous faults:** Each DFS branch is independent. Two separate live/dark boundaries on the same DT → two tickets with different `boundary_key` values.

**Dead sensor detection:** A dark pole with live children is physically impossible as a span fault. The localizer classifies it as `sensor_failure` and does not ticket it.

**Feeder-level fault:** Before per-DT processing, all DTs on a feeder are checked. If 100% of deviced poles on the feeder are dark → one feeder-level ticket.

### The 60% missing topology problem

For ~60% of DTs, `parent_pole_id` is empty. **Approach: geographic Minimum Spanning Tree (Prim's algorithm).**

1. Treat the DT location as a virtual root node
2. Run Prim's MST over all poles in the DT group, using Haversine distance as edge weight
3. The DT is the starting node; each pole joins the MST by connecting to its nearest already-connected neighbor
4. Result: a plausible tree approximating the physical line order

**Why MST works well here:** LT lines follow roads/geography. Nearby poles are physically adjacent on the line. The MST will connect them in approximately the correct order.

**Known failure mode:** At branch points, the MST may join the branch back to a mid-trunk pole rather than the branch pole, potentially missing a fault on a spur. This is declared in the confidence reason and the UI shows "⚠ inferred topology."

**Confidence for inferred topology:** Base 0.55 vs 0.90 for known topology. Adjusted ±0.05–0.10 based on sensor coverage fraction.

**In the 40% known case:** Standard tree traversal, no inference needed.

### Complexity

O(P log P) per DT for MST (Prim's with array), O(P) for tree traversal. At ~12 poles/DT median, this is negligible. Full pass over 412 DTs completes in < 50ms measured.

---

## Noise Handling

| Noise source | Handling |
|-------------|---------|
| Dead sensor (dark pole, live children) | DFS check: if all children live → `sensor_failure`, no ticket |
| Scheduled outage | Fetched from DB at start of each pass; DT/feeder skipped |
| Scheduled outage overrun (±40 min) | Grace window applied to outage end time |
| Cancelled scheduled outage | `cancelled = true` in DB; not fetched |
| Firmware 1.2.x silent devices | No `power_lost` sent → pole_state never updated → treated as live (conservative) |
| Out-of-order messages | `first_dark_at` set on first dark, never reset by later message |
| Duplicate messages | Idempotent UPSERT on pole_states; seq tracking prevents state regression |
| Debounce | `first_dark_at` must be ≥ 25s ago before localization creates ticket |

**False positive story:** The system errs toward silence over noise. A pole going dark for < 25s generates no ticket. A single isolated dark pole is classified as a sensor failure. This means we miss transient faults < 25s, which is an acceptable tradeoff for operator trust.

---

## API Surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/telemetry` | Accept pole IoT telemetry |
| GET | `/api/tickets` | List open tickets (sorted by severity) |
| GET | `/api/tickets/:id` | Ticket + poles + events |
| PATCH | `/api/tickets/:id/status` | Advance ticket status |
| GET | `/api/poles` | All poles with current state |
| GET | `/api/poles/:id` | Single pole |
| GET | `/api/poles/dts/all` | All distribution transformers |
| GET | `/api/poles/feeders/all` | All feeders |
| GET | `/api/stats` | System-wide summary stats |
| GET | `/api/scheduled-outages` | Outage feed |
| POST | `/api/scheduled-outages` | Create outage (simulator) |
| POST | `/api/simulate/fault` | Inject a fault |
| POST | `/api/simulate/repair` | Repair a fault |
| POST | `/api/simulate/noise` | Kill a device (not a fault) |
| GET | `/api/simulate/targets` | Available simulation targets |
| WS | `/ws` | Real-time event stream |

---

## UI Reasoning

**What the operator sees first:** The ticket list (sorted by status urgency: detected > acknowledged > crew_assigned) and the Leaflet map. Active faults appear as pulsing red beacons.

**What I chose NOT to show:** Raw telemetry stream, individual heartbeats, historical charts. An operator at 2 AM needs one question answered: "what is broken and where?"

**Information hierarchy:**
1. Count of active faults in the top bar (always visible, number-first)
2. Ticket list sidebar (sorted by urgency)
3. Map (geographic context + visual severity)
4. Detail panel (full information on demand)

**Which decision I expect to be wrong:** The 25-second debounce. Under fast-moving storms, this delays the alert slightly. A shorter debounce risks false positives from transient dips. The threshold is configurable via `DARK_DEBOUNCE_SEC` environment variable.

---

## The AI Feature

**What:** When a new fault ticket is created, an LLM (gpt-4o-mini) generates a 2-sentence plain-English summary displayed in the ticket detail panel.

**Why here:** The fault localization is deterministic graph traversal — an LLM would add no accuracy and cost determinism. But once the fault is located, the structured output (span ID, coordinates, confidence reason) is hard for a non-engineer to read at 2 AM. Natural language wrapping adds real value.

**Cost:** ~$0.001 per ticket at gpt-4o-mini rates. At 18 faults/day peak, ~$0.018/day.

**What happens when unavailable or wrong:** Template-based fallback is always generated first. If the LLM call fails (network, rate limit, no key), the template is displayed. The LLM result, if generated, overwrites the template asynchronously. The operator always has a readable summary.

**Why not for localization:** Graph traversal is deterministic, instant, free, and the algorithm can be explained line-by-line. An LLM for localization would be slower, probabilistic, expensive, and a black box.
