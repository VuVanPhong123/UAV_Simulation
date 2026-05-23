# coreUAV Restructure Plan

## Why restructure?

The current code works, but three files carry too much weight:

| File | Lines | Problem |
|------|-------|---------|
| `simulation_world.py` | 1562 | Order dispatch, drone movement, collision avoidance, charging, obstacle detection all in one class |
| `worker.py` | 793 | Every message type handled inline with no separation |
| `graph_map.py` | 730 | Caching, grid building, A*, wind shadow all mixed together |

`DroneAgent` (inside `simulation_world.py`) has **63 fields** — position state, mission state, collision state, and avoidance flags all crammed into one dataclass. When you need to touch collision logic you have to read through order-dispatch code to find it.

`environment.py` (single-drone) and `simulation_world.py` (multi-drone) each independently implement obstacle detection, rerouting, and altitude pop-up. Any fix to avoidance logic needs to be done twice.

---

## Target structure

```
coreUAV/
│
├── models/                  # Pure data — no computation
│   ├── statuses.py          # (existing, move here)
│   ├── order.py             # DeliveryOrder, Mission  ← from order_models.py
│   └── drone_state.py       # DronePhysics, MissionState, CollisionState  ← split from DroneAgent
│
├── physics/                 # Self-contained math, no I/O
│   ├── energy.py            # (existing energy_model.py, move here)
│   └── drone.py             # (existing drone.py, move here)
│
├── pathfinding/             # Everything spatial
│   ├── graph.py             # WaypointGraph: grid building, node queries
│   ├── astar.py             # a_star(), a_star_2_5d(), smooth_path()  ← split from graph_map.py
│   └── wind.py              # wind shadow + energy multiplier helpers  ← split from graph_map.py
│
├── simulation/              # Multi-agent orchestration
│   ├── world.py             # SimulationWorld (slim coordinator ~300 lines)
│   ├── agent.py             # DroneAgent dataclass + per-agent step logic
│   ├── collision.py         # All pairwise collision avoidance
│   ├── dispatcher.py        # dispatch_score() + order/mission lifecycle
│   └── obstacles.py         # Dynamic obstacle & NFZ management + replanning
│
├── worker/                  # WebSocket protocol only
│   ├── runner.py            # main() connection loop  ← from worker.py
│   └── handlers.py          # One function per message type
│
├── maps/                    # Map assets
│   ├── cache.py             # MapCache dataclass  ← from map_cache.py
│   └── builder.py           # build_osm_map + cache generation  ← from build_osm_map.py
│
├── scripts/                 # CLI entry points (unchanged)
│   ├── build_map_cache.py
│   ├── validate_map_cache.py
│   └── build_map_assets.py
│
├── maps/hanoi_my_dinh_me_tri_large/   # Map data (unchanged)
├── config.yaml              # (unchanged)
├── requirements.txt         # (unchanged)
└── main.py                  # Single-drone demo (unchanged)
```

---

## What each split looks like

### Split 1 — `simulation_world.py` → 4 files

This is the highest-value change. The 1562-line class becomes a slim coordinator that delegates to focused modules.

**`simulation/agent.py`** — `DroneAgent` broken into three clean dataclasses:

```python
@dataclass
class DronePhysics:
    drone: Drone
    pos_utm: tuple
    altitude: float
    heading: float
    speed: float

@dataclass
class MissionState:
    current_order_id: str | None
    current_mission_id: str | None
    current_target_type: str | None   # "pickup" | "dropoff" | "charging"
    path: list
    path_index: int
    charging_mode: bool

@dataclass
class CollisionState:
    collision_state: str              # "clear" | "warning" | "avoiding"
    collision_peer_id: str | None
    collision_distance_m: float | None
    collision_action: str | None
    hold_steps_remaining: int
    climb_steps_remaining: int

@dataclass
class DroneAgent:
    drone_id: str
    physics: DronePhysics
    mission: MissionState
    collision: CollisionState
```

Before: changing a collision field means scrolling past 40 mission/path fields.  
After: collision state is in one place, 6 fields, impossible to confuse with mission state.

**`simulation/collision.py`** — extracted from `SimulationWorld._apply_collision_avoidance()` and related helpers:

```python
def apply_collision_avoidance(agents: list[DroneAgent], config: dict) -> None:
    ...

def _choose_yielding_agent(a: DroneAgent, b: DroneAgent) -> DroneAgent:
    ...

def _estimate_closing_risk(a: DroneAgent, b: DroneAgent, steps: int) -> float:
    ...
```

**`simulation/dispatcher.py`** — order and mission lifecycle:

```python
def dispatch_score(agent, order, path_cost, config) -> float: ...
def assign_order_to_drone(world, order_id, drone_id) -> Mission: ...
def handle_pickup_arrival(world, agent) -> None: ...
def handle_dropoff_arrival(world, agent) -> None: ...
def fail_current_mission(world, agent, reason: str) -> None: ...
```

**`simulation/obstacles.py`** — dynamic obstacle management + sensor detection (removes duplication with `environment.py`):

```python
def detect_obstacles(agent, world_obstacles, sensor_range) -> list: ...
def handle_avoidance(agent, graph, config) -> bool: ...
def add_obstacle(graph, pos, radius, height) -> None: ...
def add_no_fly_zone(graph, center, radius, height, agents) -> list[DroneAgent]: ...
```

**`simulation/world.py`** — becomes a thin coordinator:

```python
class SimulationWorld:
    def step(self):
        apply_collision_avoidance(self.agents, self.config)
        for agent in self.agents.values():
            detect_obstacles(agent, ...)
            _move_agent(agent, ...)

    def receive_order_batch(self, batch): ...   # delegates to dispatcher
    def add_obstacle(self, pos, ...): ...        # delegates to obstacles
    def update_weather(self, ...): ...           # short, stays here
```

---

### Split 2 — `graph_map.py` → 3 files

**`pathfinding/graph.py`** — the grid itself:
- `WaypointGraph.__init__` (load cache or build from GeoJSON)
- `latlng_to_node()`, `latlng_to_utm()`, `is_node_clear_at_altitude()`
- Node coordinate storage, height grid, NFZ mask

**`pathfinding/astar.py`** — algorithms only, takes graph as input:
- `a_star(graph, start, goal) -> list`
- `a_star_2_5d(graph, start, goal, config) -> list`
- `smooth_path(graph, path) -> list`
- `estimate_path_cost(graph, path, config) -> float`

**`pathfinding/wind.py`** — wind calculations:
- `get_wind_shadow_nodes(graph, wind_dir, altitude) -> list`
- `check_wind_shadow(graph, node, wind_dir, altitude) -> bool`
- `get_energy_multiplier(graph, node, wind_dir, wind_speed, temp, rain) -> float`

Benefit: you can unit-test A* against a fake graph without loading GeoJSON or a cache file.

---

### Split 3 — `worker.py` → 2 files

**`worker/handlers.py`** — one function per message type:

```python
def handle_start_simulation(state: WorkerState, data: dict) -> None: ...
def handle_command(state: WorkerState, data: dict) -> None: ...
def handle_weather_update(state: WorkerState, data: dict) -> None: ...
def handle_order_batch(state: WorkerState, data: dict) -> None: ...
def handle_add_obstacle(state: WorkerState, data: dict) -> None: ...
```

**`worker/runner.py`** — the main loop becomes a dispatch table:

```python
HANDLERS = {
    "start_simulation": handle_start_simulation,
    "command":          handle_command,
    "weather_update":   handle_weather_update,
    "order_batch":      handle_order_batch,
    "add_obstacle":     handle_obstacle,
    ...
}

while True:
    msg = ws.recv()
    handler = HANDLERS.get(msg["type"])
    if handler:
        handler(state, msg)
```

Adding a new message type is now: write one function, add one line to the table.

---

### Fix 3 — Remove the `environment.py` duplication

`environment.py` (single-drone Gymnasium env) and `simulation_world.py` (multi-drone) both implement:
- Obstacle detection with sensor range
- Altitude pop-up avoidance
- Path replanning on block

After the split, both should import from `simulation/obstacles.py` instead of each having their own copy. `environment.py` can use a single-item agent list and call the same functions.

---

## Phased delivery

Do this in order — each phase is independently useful and doesn't break anything.

### Phase 1 — Move files, add `__init__.py` (1–2 hours)
No logic changes. Just create the directories, move files, fix imports.

- Create `models/`, `physics/`, `pathfinding/`, `simulation/`, `worker/`, `maps/`
- Move `statuses.py` → `models/statuses.py`
- Move `order_models.py` → `models/order.py`
- Move `energy_model.py` → `physics/energy.py`
- Move `drone.py` → `physics/drone.py`
- Move `map_cache.py` → `maps/cache.py`
- Move `build_osm_map.py` → `maps/builder.py`
- Update all import paths

Everything still runs. This alone makes the root cleaner and intent clearer.

### Phase 2 — Split `graph_map.py` (2–3 hours)
Extract `astar.py` and `wind.py` from `graph_map.py`.  
`WaypointGraph` stays in `pathfinding/graph.py` but `a_star`, `a_star_2_5d`, `smooth_path` become standalone functions that accept a graph argument.  
Write 3–4 unit tests for A* on a tiny synthetic grid.

### Phase 3 — Split `DroneAgent` and extract `collision.py` (3–4 hours)
Break the 63-field dataclass into `DronePhysics + MissionState + CollisionState`.  
Move all `_apply_collision_avoidance` logic to `simulation/collision.py`.  
`SimulationWorld.step()` calls the extracted function.

### Phase 4 — Extract `dispatcher.py` and `obstacles.py` (2–3 hours)
Pull order/mission lifecycle out of `SimulationWorld` into `simulation/dispatcher.py`.  
Pull obstacle detection and dynamic NFZ into `simulation/obstacles.py`.  
Rewrite `environment.py` to call the shared obstacle functions instead of its own copy.

### Phase 5 — Split `worker.py` into handler table (1–2 hours)
Straightforward refactor — no logic changes, just reorganization.

---

## What stays the same

- `config.yaml` — no changes
- `maps/` data directory — no changes
- `scripts/` — no changes
- `main.py` — no changes
- `requirements.txt` — no changes
- The WebSocket protocol with the broker — no changes
- All message types and field names — no changes

The broker and frontend are completely unaffected by any of this.

---

## After the restructure: what gets easier

| Task | Before | After |
|------|--------|-------|
| Add a new collision avoidance strategy | Hunt through 1562-line file | Edit `simulation/collision.py` only |
| Add a new message type to worker | Add if/elif in 793-line loop | Add one function + one line to dispatch table |
| Unit-test A* pathfinding | Must load real GeoJSON | Pass a 5×5 synthetic graph |
| Fix obstacle detection bug | Fix it in 2 places (env + world) | Fix it once in `obstacles.py` |
| Understand DroneAgent state | Read 63 fields | Read 3 focused dataclasses |
| Add a new map | Extend graph.py only | Same — but it's clearly isolated |
