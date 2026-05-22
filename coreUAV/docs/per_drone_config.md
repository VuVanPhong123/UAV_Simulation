# Per-Drone Configuration

Allows individual drones to have custom simulation parameters. Any field not specified falls back to the global defaults in `config.yaml`.

---

## Configurable Parameters

All keys match the `drone:` section in `config.yaml`.

| Key | Default | Description |
|-----|---------|-------------|
| `max_battery` | `100.0` | Maximum battery capacity (%) |
| `discharge_rate_base` | `0.05` | Battery drain per second during level flight |
| `discharge_rate_climb` | `1.2` | Battery drain per second while climbing |
| `speed` | `20.0` | Cruise speed (m/s) |
| `battery_low_threshold` | `30.0` | Battery % that triggers a reroute to charger |
| `battery_safe_target` | `80.0` | Battery % at which charging stops and drone resumes |
| `recharge_rate` | `10.0` | Battery % restored per second at a charging station |
| `max_altitude` | `50.0` | Hard altitude ceiling (m) |
| `min_altitude` | `5.0` | Hard altitude floor (m) |
| `normal_altitude` | `20.0` | Default cruise altitude (m) |
| `payload_weight` | `2.5` | Payload carried (kg) |
| `payload_penalty` | `0.05` | Energy multiplier per kg: `1 + weight × penalty` |

---

## Usage

### 1. At Startup — via WebSocket `start_simulation`

Include a `droneConfigs` object in the `start_simulation` payload. Keys are drone IDs; values are partial config objects (only the fields you want to override).

```json
{
  "type": "start_simulation",
  "simId": "abc123",
  "frontendId": "fe_1",
  "payload": {
    "droneCount": 3,
    "droneConfigs": {
      "drone_1": { "max_battery": 150.0, "speed": 30.0 },
      "drone_2": { "discharge_rate_base": 0.02, "payload_weight": 5.0 },
      "drone_3": {}
    }
  }
}
```

- `drone_1` gets a bigger battery and faster speed; all other fields use defaults.
- `drone_2` gets a more efficient discharge rate and heavier payload; all other fields use defaults.
- `drone_3` (or any drone not listed) uses all defaults from `config.yaml`.

---

### 2. Mid-Simulation — via `configure_drone` message

Reconfigure a drone while it is running. The drone's current battery level is preserved.

```json
{
  "type": "configure_drone",
  "simId": "abc123",
  "frontendId": "fe_1",
  "payload": {
    "droneId": "drone_1",
    "config": {
      "speed": 10.0,
      "payload_weight": 8.0
    }
  }
}
```

Only the fields listed in `config` are changed. All other attributes keep their current values.

---

### 3. Python API — `SimulationWorld.setup_drone()`

Call directly on the `SimulationWorld` instance. Works before or during simulation.

```python
world = SimulationWorld(config, drone_count=3)

# Before simulation starts
world.setup_drone("drone_1", max_battery=150.0, speed=30.0)
world.setup_drone("drone_2", discharge_rate_base=0.02)
# drone_3 gets all defaults — no call needed

# Mid-simulation (battery level is preserved)
world.setup_drone("drone_1", speed=10.0)
```

You can also pass configs at construction time:

```python
world = SimulationWorld(config, drone_count=3, drone_configs={
    "drone_1": {"max_battery": 150.0, "speed": 30.0},
    "drone_2": {"discharge_rate_base": 0.02},
})
```

---

## Sharding / `droneIdOffset`

When using multi-worker sharding, drone IDs are globally offset. Use the globally-assigned IDs as keys:

```
droneIdOffset = 10, droneCount = 3  →  drone_11, drone_12, drone_13
```

```json
"droneConfigs": {
  "drone_11": { "speed": 25.0 },
  "drone_12": { "max_battery": 120.0 }
}
```

---

## Behavior Reference

| Scenario | Result |
|----------|--------|
| Drone ID not in `droneConfigs` | All parameters use `config.yaml` defaults |
| Field omitted from override | Falls back to `config.yaml` default for that field |
| `setup_drone` called before `reset()` | Overrides stored and applied when drones are created |
| `setup_drone` called mid-simulation | Drone attributes updated immediately; battery level unchanged |
| `reset()` called again | Stored overrides are re-applied to freshly created drones |
| Unknown field in override | Silently ignored |

---

## Files Modified

| File | Change |
|------|--------|
| `coreUAV/physics/drone.py` | `Drone.__init__` accepts `overrides=None`; merges with base config |
| `coreUAV/simulation_world.py` | Constructor accepts `drone_configs`; `setup_drone()` method added |
| `coreUAV/worker/handlers.py` | `start_simulation` extracts `droneConfigs`; `handle_configure_drone` added |
| `coreUAV/worker/runner.py` | `handle_configure_drone` registered in `HANDLERS` |
