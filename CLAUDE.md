# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UAV Delivery Simulation — a distributed, real-time multi-agent system simulating autonomous drone delivery over urban environments (Hanoi My Dinh area). The system uses a broker-worker-client pattern.

## Architecture

```
Frontend (Next.js) <──WebSocket──> Broker (Node.js) <──WebSocket──> Workers (Python)
```

**Four components:**
- `server/` — WebSocket broker (Node.js/Express/ws), routes messages between frontends and workers, manages sharding
- `coreUAV/` — Simulation engine (Python), handles UAV physics, pathfinding, dispatch, energy modeling
- `fe/` — Ground Control Station dashboard (Next.js/React/TypeScript/Leaflet)
- `test/` — E2E tests (Playwright)

**Sharding:** The broker can split a simulation of N drones across M workers (e.g., 30 drones → 2 workers × 15 each). Workers register via `"type": "register"` WebSocket messages.

## Running the Project

### Docker (recommended)
```bash
docker compose up --build
```
Starts broker on `ws://localhost:8080`, 2 Python workers, and frontend on `http://localhost:3000`.

### Manual (3 terminals)

**Terminal 1 — Broker:**
```bash
cd server
npm install
node index.js
```

**Terminal 2 — Python Worker:**
```bash
cd coreUAV
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
set BROKER_WS_URL=ws://localhost:8080
set WORKER_NAME=local-worker-1
set WORKER_MAX_DRONES=15
set WORKER_SUPPORTS_SHARDING=true
python worker.py
```

**Terminal 3 — Frontend:**
```bash
cd fe
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint       # ESLint
```

### E2E Tests
```bash
cd test
npm install
npm run test:e2e   # Playwright
```

## Core Python Modules (`coreUAV/`)

| File | Role |
|------|------|
| `worker.py` | WebSocket entry point; orchestrates simulation per message |
| `simulation_world.py` | Multi-drone simulation state, physics tick, collision detection |
| `drone.py` | Drone model: battery, temperature, status state machine |
| `energy_model.py` | Battery drain physics (wind, temperature, rain, payload, climb) |
| `graph_map.py` | 2.5D waypoint graph; A\*/Dijkstra pathfinding; obstacle inflation |
| `dispatch_engine.py` | Assigns orders to drones via priority scoring |
| `order_models.py` | `DeliveryOrder`, `Mission` dataclasses |
| `statuses.py` | Enums: `DroneStatus`, `OrderStatus`, `MissionStatus`, `EventCode` |
| `map_cache.py` | Pre-computed height grids for pathfinding performance |
| `config.yaml` | All tunable parameters (speeds, battery rates, map bounds, altitude levels) |

## Key Frontend Files (`fe/`)

- `app/components/GcsDashboard.tsx` — Central state orchestrator; owns all simulation state
- `app/components/UavMap.tsx` — Leaflet map; renders UAVs, routes, obstacles, wind overlay
- `app/hooks/useSimulationSocket.ts` — WebSocket connection management
- `app/types/simulation.ts` — TypeScript types for all simulation entities

## Worker Environment Variables

```
BROKER_WS_URL           WebSocket broker URL (default: ws://localhost:8080)
WORKER_NAME             Unique worker identifier
WORKER_MAX_DRONES       Drone capacity (1–15)
WORKER_SUPPORTS_SHARDING  Enable multi-worker splitting
```

## Map Data

Pre-computed map assets live in `coreUAV/maps/hanoi_my_dinh_me_tri_large/` (`grid_cache.npz`, `buildings.geojson`, `metadata.json`). To regenerate:
```bash
cd coreUAV
python build_map_cache.py
python validate_map_cache.py
```
`build_osm_map.py` fetches fresh building data from OpenStreetMap via `osmnx`.

## Status Enumerations

**Drone:** `idle` → `planning` → `flying` → `rerouting` / `charging` / `paused` / `success` / `failed` / `emergency_landing`

**Order:** `pending` → `assigned` → `going_to_pickup` → `picked_up` → `delivering` → `completed` / `failed` / `canceled`

## Simulation Parameters (`coreUAV/config.yaml`)

Key values to know when debugging behavior:
- Drone speed: 20 m/s, altitude levels: 20 / 35 / 50 m
- Time step: 0.1 s
- Max drones per worker: 15
- Grid resolution: 15 m
- Obstacle sensor range: 30 m
