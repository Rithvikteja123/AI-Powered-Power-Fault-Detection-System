# Decision Log — Newest First

---

## [2026-08-05] Localization runs every 15s (not on every event)

**Chose:** Cron-based localization pass every 15 seconds.  
**Rejected:** Event-driven: run localization on every `power_lost` message.  
**Why:** Event-driven would fire localization hundreds of times per second during a large outage burst, creating thundering-herd on the DB. A 15s cadence stays well within the 120s p95 target (max latency is ~25s debounce + ~15s cron = ~40s).  
**Tradeoff:** Very fast (<5s) transient faults may be missed if they self-recover before the next pass. Acceptable — the brief was about sustained outages, not millisecond transients.

---

## [2026-08-05] MST-based topology inference for 60% of DTs

**Chose:** Geographic Minimum Spanning Tree (Prim's algorithm) rooted at the DT location.  
**Rejected alternatives:**
- "Survey first, build later" — survey takes 8 months; operators need a system today
- DT-level fallback only — gives less precise location (whole DT instead of span)
- Historical outage learning — needs months of data to converge  

**Why MST:** LT lines follow geography; nearby poles are physically adjacent. MST with Haversine distance produces a plausible tree that is correct ~70% of the time on branches.  
**Known failure mode:** Branch points may be misjoinerd — a spur pole might connect to a mid-trunk pole rather than the correct junction pole, causing the algorithm to miss a fault on that spur. This is displayed in the UI as "⚠ inferred topology" and confidence is capped at 0.65.  
**What we tell the operator:** "Location inferred from GPS — wiring diagram unavailable." They can navigate to the general area; the lineman's job is to verify locally.

---

## [2026-08-05] LLM used for summaries, NOT for localization

**Chose:** LLM generates a 2-sentence plain-English summary after deterministic localization.  
**Rejected:** Using LLM for fault localization itself.  
**Why:** Graph traversal is O(P) per DT, deterministic, free, explainable, and correct by construction. An LLM would be ~100× slower, probabilistic, expensive, and a black box to the operator asking "why did you put the fault there?"  
**AI earns its keep:** Converting `"fault on span P-001→P-002, conf 87%, 14 poles, PIN 560078"` into `"A wire break between poles P-001 and P-002 has cut power to 14 downstream poles in Ward 84 (PIN 560078). 87% confidence based on 11/14 sensors reporting dark."` saves 10 seconds of reading time for a tired operator at 2 AM.

---

## [2026-08-05] 25-second debounce before ticketing

**Chose:** 25 seconds (`first_dark_at` must be ≥ 25s old).  
**Rejected:** 0s (immediate), 60s (too slow).  
**Why:** Eliminates single-message transients and out-of-order message confusion. Stays under the 120s p95 target (25s debounce + 15s cron max = 40s). Configurable via `DARK_DEBOUNCE_SEC`.  
**Assumption:** A fault that self-heals in < 25s is not worth a ticket. Documented here.

---

## [2026-08-05] PostgreSQL with no Redis

**Chose:** PostgreSQL for all storage, in-memory ring buffer for burst absorption.  
**Rejected:** Redis/Bull for message queue.  
**Why:** Redis would add operational complexity (third container, config, replication). The in-memory ring buffer with batch writes handles 500+ msg/s without Redis. The ring buffer survives process restarts poorly, but we are in a single-container deployment — an acceptable tradeoff.  
**If scaling to 30 subdivisions:** This would need Redis Streams or Kafka for durable queuing across horizontally-scaled backend instances.

---

## [2026-08-05] CartoDB dark tiles over OpenStreetMap default

**Chose:** CartoDB dark_all tiles (free, no API key).  
**Rejected:** Mapbox (requires API key), standard OSM (light theme).  
**Why:** Dark theme matches operator console. CartoDB tiles work for reviewers with no key. Attribution included.

---

## [2026-08-05] Boundary key deduplication for tickets

**Chose:** `boundary_key` as a unique string (e.g. `span_P-001_P-002`) on the `fault_tickets` table with a UNIQUE constraint.  
**Rejected:** Always creating new tickets, merging by geography radius.  
**Why:** Ensures the localizer can re-run every 15s without creating duplicate tickets. The same fault, detected on multiple passes, UPSERTs confidence and affected count but doesn't create a new ticket.  
**Edge case:** Two separate faults on the same span (e.g. wire cut at same location twice) get the same boundary_key. In practice, the first fault's ticket would be active, so the second detection just updates it. This is correct behavior.

---

## Known issues and fragile points

1. **No persistence for in-memory ring buffer:** If the backend crashes mid-burst, messages in the buffer are lost. In production, this would be a message broker (MQTT → Kafka → workers).

2. **MST inference is globally suboptimal for complex topologies:** Networks with many close-together branches from different lines can get mis-connected. The confidence score reflects this uncertainty.

3. **Restoration detection latency:** Restoration is checked every 15s by the localizer cron. A pole that comes back at second 1 may take up to 15s to auto-verify. Well within the 120s target.

4. **No auth:** A hardcoded operator identity is used per the brief's explicit instruction. Adding auth would be ~2 hours of work with Passport.js + session cookies.

## With two more weeks

- MQTT broker (Mosquitto) integration to replace the HTTPS endpoint
- Multi-subdivision support: partition by feeder_id for horizontal scaling
- Topology learning from historical outage co-occurrence
- Mobile-responsive layout for field use
- Alerting integrations (SMS via Twilio, WhatsApp via WATI)
