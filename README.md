KSPDB Power Grid Fault Detection & Localization System

A real-time fault detection and localization platform built for the Karnataka State Power Distribution Board (KSPDB). The system reduces the manual fault identification process from approximately two hours to under two minutes by analyzing telemetry from pole-mounted IoT devices.

Overview

This project monitors the power status of distribution poles, detects outages in real time, identifies the most likely fault location, and manages the complete incident lifecycle through an operator dashboard.

The application includes a fault simulator, real-time telemetry processing, graph-based fault localization, automated ticket management, and an interactive map for monitoring the distribution network.

Features
Real-time telemetry ingestion from pole-mounted IoT devices
Graph-based fault localization using network topology
Automatic detection of span faults, transformer failures, and feeder outages
Interactive map showing poles, transformers, and localized faults
Incident management with automated ticket creation and verification
Noise filtering for dead sensors and planned outages
Built-in fault simulator for testing different outage scenarios
Hybrid database support using PostgreSQL and SQLite
Automated unit tests covering localization and topology logic
Getting Started
Local Development (SQLite)

Backend

cd backend
npm install
npm run dev

Frontend

cd frontend
npm install
npm run dev

Open:

http://localhost:3005

Docker Deployment (PostgreSQL)

docker-compose up --build

Services:

Frontend: http://localhost:3005
Backend API: http://localhost:4000
PostgreSQL: localhost:5432
Running Tests

Execute the backend test suite:

cd backend
npm test

Example output:

Localization Test Suite

Span fault detection — PASS
Dead sensor filtering — PASS
Topology generation — PASS
Multiple fault detection — PASS
Topology inference — PASS
Graph traversal — PASS

Results:

23 tests passed
0 tests failed
Project Structure

kspdb-fault-system/

backend/

src/
db/
routes/
services/
algorithms/
seed/
tests/

frontend/

src/
components/
pages/
services/

docker-compose.yml

ARCHITECTURE.md

DEPLOYMENT.md

DECISIONS.md

AI-WORKFLOW.md

Simulator

The simulator allows reviewers to test the system without requiring real hardware.

Supported scenarios include:

Span wire fault
Distribution transformer fault
Feeder outage
Dead sensor
Power restoration

Each simulation generates telemetry that flows through the same detection pipeline used by the application.

Documentation

The repository includes:

README.md – Project overview and setup instructions
ARCHITECTURE.md – System design and localization algorithm
DEPLOYMENT.md – Deployment and troubleshooting guide
DECISIONS.md – Design decisions and assumptions
AI-WORKFLOW.md – AI-assisted development process
