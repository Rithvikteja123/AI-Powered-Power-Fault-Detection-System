# ⚡ KSPDB Power Grid Fault Detection & Localization System

> **Real-time power grid outage localization for Karnataka State Power Distribution Board (KSPDB)**. Compresses the manual 2-hour fault-finding process down to under **2 minutes**.

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Node](https://img.shields.io/badge/Node.js-v18%2B-green.svg)
![React](https://img.shields.io/badge/React-v18-blue.svg)
![Leaflet](https://img.shields.io/badge/Leaflet-v1.9-green.svg)
![Database](https://img.shields.io/badge/Database-PostgreSQL%20%7C%20SQLite-darkblue.svg)
![Tests](https://img.shields.io/badge/Tests-23%2F23%20Passing-brightgreen.svg)

---

## 🌟 Key Features & Capabilities

- 📡 **High-Throughput Telemetry Ingestion:** Processes IoT telemetry from ~5,000 pole-mounted sensors at 500+ events/sec via memory ring-buffer queue.
- 🌳 **Graph-Based Fault Localization:** Builds topological trees (DFS) & infers unknown topologies using Kruskal’s Minimum Spanning Tree (MST) algorithm.
- ⚡ **Boundary Classification Engine:** Identifies exact failing wire spans, DT transformers, or 11kV feeder lines by detecting live/dark boundary transitions.
- 📍 **GPS & PIN Code Mapping:** Automatically pinpoints fault locations on an interactive Leaflet dark-theme map centered in Bengaluru.
- 📊 **Real-Time SaaS Operator Console:** Modern dark-mode UI with live metric cards (`Active Faults`, `Poles Dark`, `Households Affected`, `Resolved 24H`).
- 📂 **Active vs. Resolved Incident Workflow:** Separate `Active`, `Resolved`, and `All` tabs with `✅ Power Restored` badges and explicit ticket archiving.
- 🕒 **ISO 8601 UTC Timestamp Tracking:** Accurate real-time event duration and resolution timers (`just now`, `5m ago`).
- 🔌 **Hybrid Dual Database Engine:** Automatically runs on **PostgreSQL** in Docker/Cloud or seamless **SQLite fallback (`better-sqlite3`)** for zero-config local development.
- 💥 **Interactive Simulation Dock:** Inject span wire breaks, DT failures, feeder trips, or dead modem noise directly from the browser.

---

## 🚀 Quick Start Guide

### Option 1: Local Development Mode (Zero-Config SQLite)

```bash
# 1. Start Backend (Port 4000)
cd backend
npm install
npm run dev

# 2. Open a new terminal: Start Frontend (Port 3005)
cd ../frontend
npm install
npm run dev
```

Open your browser at **`http://localhost:3005`**.

---

### Option 2: Docker Compose (Production Setup with PostgreSQL)

```bash
docker-compose up --build
```

- **Frontend Console:** `http://localhost:3005`
- **Backend API:** `http://localhost:4000`
- **PostgreSQL Database:** `localhost:5432`

---

## 🧪 Automated Testing & Verification

Run the full unit test suite covering fault boundary detection, dead sensor noise filtering, multi-fault isolation, and topology tree building:

```bash
cd backend
npm test
```

```text
═══════════════════════════════════════
  Localizer Unit Tests
═══════════════════════════════════════
Test 1: Span fault (P2→P3) in linear chain — PASS ✅
Test 2: Dead sensor (P2 dark, children live) — PASS ✅
Test 3: Known topology tree building — PASS ✅
Test 4: Two simultaneous faults on different branches — PASS ✅
Test 5: Inferred topology (MST) builds plausible tree — PASS ✅
Test 6: collectDescendants from topology — PASS ✅

═══════════════════════════════════════
  Results: 23 passed, 0 failed
═══════════════════════════════════════
```

---

## 📁 Repository Structure

```text
kspdb-fault-system/
├── backend/               # Node.js + Express + PostgreSQL/SQLite Backend
│   ├── src/
│   │   ├── db.js          # Hybrid Dual-DB Adapter (SQLite + PG)
│   │   ├── services/      # Localizer, Topology, Ticket Manager, AI Summary
│   │   ├── routes/        # Telemetry, Tickets, Stats, Simulator API
│   │   └── seed/          # Network & Pole Data Seeder
│   └── tests/             # Unit tests (23/23 passing)
├── frontend/              # React 18 + Vite + Leaflet Frontend
│   └── src/
│       ├── components/    # MapView, TicketList, TicketDetail, SimulatorPanel
│       └── pages/         # Dashboard Operator Console
├── docker-compose.yml     # Multi-container containerized deployment
├── ARCHITECTURE.md        # Technical System Design & Data Flow
├── DEPLOYMENT.md          # Production Deployment Guide
├── DECISIONS.md           # Architecture Decision Log
└── AI-WORKFLOW.md         # AI Pair Programming Log
```

---

## 🎮 Simulator Controls

Use the bottom **Simulation Dock** in the dashboard to test grid events:
- **Inject Fault:** Select a fault type (`Span Wire Break`, `DT Transformer`, `Feeder Line`) and target pole to trigger real-time detection.
- **Repair Lines:** Restores dark poles to energised state and auto-resolves open tickets.
- **Dead Sensor:** Simulates an isolated modem failure without generating false fault tickets.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
