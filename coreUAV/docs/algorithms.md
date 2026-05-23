# UAV Simulation — Core Algorithms

This document covers the five algorithm subsystems inside `coreUAV/`.

---

## Table of Contents

1. [Pathfinding — 2.5D A*](#1-pathfinding--25d-a)
2. [Dispatch — Multi-Factor Scoring](#2-dispatch--multi-factor-scoring)
3. [Energy Model — Battery Drain Physics](#3-energy-model--battery-drain-physics)
4. [Physics Tick & Collision Avoidance](#4-physics-tick--collision-avoidance)
5. [Drone & Order State Machines](#5-drone--order-state-machines)

---

## 1. Pathfinding — 2.5D A*

**Files:** `pathfinding/astar.py`, `pathfinding/graph.py`

### WaypointGraph

`graph.py` wraps a pre-built grid loaded from `maps/<mapId>/grid_cache.npz`. Coordinates flow:

```
GPS (lat/lng) → UTM (meters) → grid node (col, row)
```

The grid has configurable altitude levels (default: 20 m / 35 m / 50 m). Each cell is either blocked (building footprint + inflation margin) or free. No-fly zones and dynamic obstacles are layered on top at runtime.

### Flat 2D A* — `a_star()`

Used for quick path cost estimation and fallback routing at a fixed altitude. Standard A* on a 2D grid with 8-directional movement (cardinal + diagonal). Blocked cells, no-fly zones, and inflated obstacle footprints are treated as walls.

### 2.5D A* — `a_star_2_5d()`

The main flight-path planner. State space: `(col, row, altitude_level)`.

**Neighbors per node:**
- Horizontal: 8 directions at the same altitude
- Vertical: climb to next band, descend to previous band (no horizontal movement during altitude change)

**Edge cost formula:**

```
cost = base_distance × energy_multiplier(wind, temp, rain) × altitude_factor
```

Where:
- `altitude_factor` = 2.0 for climbing, 0.5 for descending, 1.0 for level flight
- `energy_multiplier` is computed from environmental conditions (see §3)

**Heuristic:**

```
h = 1.8 × euclidean_distance(current, goal) + altitude_band_distance × altitude_bias
```

The 1.8 weight makes the heuristic inadmissible (slightly greedy) for speed — acceptable because we optimize for flight time, not strict optimality.

**Post-processing:**

After A* returns a node list, `smooth_path()` runs a line-of-sight check (Bresenham algorithm) to remove redundant intermediate waypoints. The result is a compact sequence of `(col, row, altitude)` waypoints.

### Path Cost Estimation — `estimate_path_cost()`

Used by the dispatch engine before committing a drone to an order. Runs A* with environmental weights but returns only the total cost scalar, not the full path. This keeps dispatch fast.

---

## 2. Dispatch — Multi-Factor Scoring

**Files:** `dispatch_engine.py`, `simulation/dispatcher.py`

### Score Function — `dispatch_score()`

When `dispatch_pending_orders()` runs, every idle drone is scored against every pending order. The drone with the **lowest score** wins the assignment.

```python
score = path_cost(drone → pickup → dropoff)
      + payload_kg × 20.0
      + priority_adjustment(order.priority)
      + battery_risk_penalty(drone.battery)
```

| Term | Value |
|---|---|
| `priority_adjustment` — urgent | −100 |
| `priority_adjustment` — high | −50 |
| `priority_adjustment` — normal | 0 |
| `priority_adjustment` — low | +25 |
| `battery_risk_penalty` — below 35% | → ∞ (ineligible) |
| `battery_risk_penalty` — 35–60% | exponential ramp |

Path cost dominates for equal-priority orders, so closer drones win. The urgency adjustment can override distance for urgent orders.

### Assignment Loop — `dispatch_pending_orders()`

```
for each pending order (sorted by priority desc, then deadline asc):
    candidates = [drone for drone in fleet if drone.status == IDLE]
    best = min(candidates, key=lambda d: dispatch_score(d, order))
    assign(best, order)  → status: PLANNING → FLYING
```

Assignment is greedy (no global optimum search). Orders with earlier deadlines break ties after priority.

### Order Lifecycle — `handle_pickup_arrival()` / `handle_dropoff_arrival()`

On reaching the pickup node the drone's `current_target_type` switches from `TO_PICKUP` to `TO_DROPOFF`, the order status advances to `PICKED_UP`, and A* replans to the dropoff node. On reaching the dropoff node the order completes, the drone resets to `IDLE`, and `dispatch_pending_orders()` is called again immediately to reassign the freed drone.

---

## 3. Energy Model — Battery Drain Physics

**Files:** `physics/energy.py`, `physics/drone.py`

### Drain Rate — `battery_drain_rate()`

```
drain_per_second = base_rate
                 × payload_multiplier(kg)
                 × wind_multiplier(speed, heading_delta)
                 × temperature_multiplier(temp_c)
                 × rain_multiplier(raining)
                 × climb_factor(altitude_delta)
```

Each multiplier is independent and multiplicative.

### Wind Factor — `wind_factor()`

Resolves the angle between drone heading and wind direction:

| Condition | Multiplier |
|---|---|
| Pure headwind | up to 2.5× |
| Pure tailwind | down to 0.65× |
| Crosswind | 1.0–1.5× (adds lateral drag) |

Uses `cos(angle)` for head/tail component and `abs(sin(angle))` for cross component.

### Temperature Factor — `temperature_factor()`

```
multiplier = 1 + 0.002 × (temp_c − 25)²
```

Optimal temperature is 25 °C. Both hot and cold conditions degrade battery efficiency symmetrically.

### Rain Factor — `rain_factor()`

Returns three multipliers applied independently:
- **Speed:** 0.85 (drone slows down in rain)
- **Energy:** 1.15 (15% extra drain for waterproofing/heating)
- **Sensor range:** reduced (affects obstacle detection radius)

### Climb Factor — `climb_energy_factor()`

- Climbing: 1.5× base drain
- Level flight: 1.0×
- Descending: 0.7× (motors assist braking, less thrust needed)

### Battery State — `Drone.consume_battery()` / `recharge()`

Each simulation tick calls `consume_battery(dt, ...)` which integrates `drain_per_second × dt` and subtracts from `battery_pct`. When the drone docks at a charging station, `recharge(dt)` adds `recharge_rate_per_second × dt` until `battery_pct` reaches the configured safe target (default 80%).

---

## 4. Physics Tick & Collision Avoidance

**Files:** `simulation_world.py`, `simulation/collision.py`

### Main Tick — `SimulationWorld.step()`

Runs every 0.1 s (configured in `config.yaml`). Execution order per tick:

```
1. CollisionSystem.apply(agents)        — detect & queue avoidance actions
2. for each agent:
   a. _handle_charging()               — if docked, recharge; if full, resume
   b. _maybe_reroute_to_charging()     — if battery low, replan to charger
   c. _apply_pending_avoidance()       — execute climb/hold/slow from step 1
   d. _move_agent()                    — advance along path
3. update_weather()                    — drift wind/temp/rain over time
```

### Movement — `_move_agent()`

Per tick, the drone moves `speed × temp_speed_factor × dt` meters along its current path segment. Altitude is adjusted independently at `vertical_speed × dt` m/s toward the target altitude band. When the drone arrives within `arrival_threshold` of the current waypoint, `path_index` advances to the next waypoint.

On reaching the final waypoint, the handler checks `current_target_type`:
- `TO_PICKUP` → call `handle_pickup_arrival()`
- `TO_DROPOFF` → call `handle_dropoff_arrival()`
- `TO_CHARGER` → dock and begin charging

### Collision Detection — `CollisionSystem.apply()`

Runs pairwise over all flying drones. For each pair:

**Proximity classification:**

| Distance | State |
|---|---|
| > `warning_distance` (30 m) | clear |
| `safety_distance`–`warning_distance` (15–30 m) | `proximity_warning` |
| < `safety_distance` (15 m) | collision risk |

**Prediction — `_estimate_closing_risk()`**

Projects each drone's position forward over `collision_prediction_steps = 3` future ticks. If the predicted minimum separation ever falls below `safety_distance`, the pair is flagged.

**Avoidance — `_apply_collision_avoidance()`**

Priority assignment: a drone carrying a payload (order status `PICKED_UP`) always has priority. If both or neither carry payloads, the lower drone yields.

Yielding drone actions, tried in order:
1. **Climb** — if a higher altitude band is free, queue a `climbing_avoidance` action; A* replans at new altitude
2. **Hold** — if no altitude band available, queue `yielding_hold`; drone stops for `hold_ticks` steps
3. **Slow** — during proximity warning without imminent collision, apply `temp_speed_factor = 0.45–0.75`

---

## 5. Drone & Order State Machines

**Files:** `models/statuses.py`, `simulation/agent.py`, `simulation/dispatcher.py`

### DroneStatus FSM

```
                   ┌──────────────────────────────┐
                   │                              ▼
IDLE ──dispatch──► PLANNING ──path found──► FLYING ──order done──► SUCCESS
                       │                     │   │
                  no path                    │   └──low battery──► CHARGING ──full──► FLYING
                       │               collision                          
                       ▼                     │                    
                    FAILED             (still FLYING,
                                       avoidance_steps active)
                                             │
                                       battery depleted
                                             ▼
                                    EMERGENCY_LANDING

Any state ──pause command──► PAUSED ──resume command──► (restore prior status)
```

### OrderStatus FSM

```
PENDING ──assigned──► ASSIGNED ──drone departs──► GOING_TO_PICKUP
    ──────────────────────────────────────────────────────────────►
                                                  GOING_TO_PICKUP
                                                       │
                                                  pickup arrived
                                                       ▼
                                                  PICKED_UP ──en route──► DELIVERING
                                                                               │
                                                                          dropoff arrived
                                                                               ▼
                                                                          COMPLETED
Any state ──fail_mission()──► FAILED
Any state ──cancel command──► CANCELED
```

### MissionStatus FSM

Runs in parallel with `OrderStatus`, scoped to the physical flight plan:

```
PLANNED → TO_PICKUP → PICKUP_ARRIVED → TO_DROPOFF → COMPLETED
                                                          │
                                                       or FAILED
```

### Key Transition Functions

| Function | File | What it does |
|---|---|---|
| `dispatch_pending_orders()` | `dispatcher.py:242` | Assigns orders, sets drone → PLANNING |
| `_replan_agent()` | `simulation_world.py:248` | Runs A*, sets drone → FLYING or FAILED |
| `handle_pickup_arrival()` | `dispatcher.py:166` | Advances order + mission, replans to dropoff |
| `handle_dropoff_arrival()` | `dispatcher.py:208` | Completes order, resets drone → IDLE |
| `fail_mission()` | `dispatcher.py:124` | Atomically fails order + mission + drone |
| `_handle_charging()` | `simulation_world.py:312` | Charges battery; transitions back to FLYING when full |

### DroneAgent Dataclass — `simulation/agent.py`

Binds a `Drone` object to its current runtime state:

```python
@dataclass
class DroneAgent:
    drone: Drone                  # physics + battery model
    start_node: tuple             # grid (col, row)
    goal_node: tuple | None
    path: list[tuple]             # list of (col, row, alt) waypoints
    path_index: int
    current_target_node: tuple | None
    current_target_type: str | None   # TO_PICKUP | TO_DROPOFF | TO_CHARGER
    current_target_altitude: int
    current_order_id: str | None
    current_mission_id: str | None
    # collision state
    collision_peer_id: str | None
    collision_distance_m: float
    collision_avoidance_reason: str | None
    avoidance_steps: int
    # performance counters
    num_replans: int
    num_charging_stops: int
    temp_speed_factor: float          # 1.0 = full speed; 0.45–0.75 during avoidance
```

---

## How the Subsystems Connect

```
User places orders
  └─► dispatch_pending_orders()
        └─► dispatch_score() calls estimate_path_cost()
              └─► a_star_2_5d() with energy_multiplier weights
        └─► best drone assigned → status: PLANNING
              └─► _replan_agent() calls a_star_2_5d() for full path
                    └─► status: FLYING

Each tick (0.1 s):
  CollisionSystem.apply()
    └─► pairwise proximity check → queue avoidance actions
  _move_agent()
    └─► advance path_index, consume_battery(dt)
          └─► battery_drain_rate() × dt
    └─► on waypoint arrival → handle_pickup / handle_dropoff / dock charger
  update_weather()
    └─► wind/temp/rain drift → triggers replan for affected drones
```
