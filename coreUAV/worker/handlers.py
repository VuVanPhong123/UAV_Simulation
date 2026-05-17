import copy
import json

from pyproj import Transformer

from maps.cache import cache_exists
from models.statuses import EventCode, EventLevel
from simulation_world import SimulationWorld

from worker.sender import (
    SYSTEM_DRONE_ID,
    drain_order_mission_updates,
    drain_world_events,
    mark_current_paths,
    send_all_planned_paths,
    send_all_telemetry,
    send_config,
    send_event,
    send_mission_update,
    send_order_state,
    send_order_update,
    send_planned_path_for_agent,
    send_simulation_finished,
    send_wind_shadow_zones,
    send_worker_status,
)

_DEFAULT_MAP_ID = "hanoi_my_dinh_me_tri_large"


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def clamp_int(value, minimum, maximum, fallback):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def config_for_map(base_config, requested_map_id=None):
    next_config = copy.deepcopy(base_config)
    map_config = next_config.setdefault("map", {})
    presets = map_config.get("presets", {})
    map_id = requested_map_id or map_config.get("map_id") or _DEFAULT_MAP_ID
    if map_id != _DEFAULT_MAP_ID:
        map_id = _DEFAULT_MAP_ID
    if map_id not in presets:
        map_id = _DEFAULT_MAP_ID
    preset = presets.get(map_id)
    if preset:
        map_config["map_id"] = preset.get("mapId", map_id)
        map_config["label"] = preset.get("label", map_config.get("label", map_id))
        for key in (
            "start_latlng", "goal_latlng", "charging_stations_latlng",
            "no_fly_zones", "safe_order_points", "building_geojson_url", "bounds",
        ):
            if key in preset:
                map_config[key] = copy.deepcopy(preset[key])
        if "grid_resolution" in preset:
            next_config.setdefault("performance", {})["grid_resolution"] = float(preset["grid_resolution"])
        if "altitude_levels" in preset:
            next_config.setdefault("performance", {})["altitude_levels"] = copy.deepcopy(preset["altitude_levels"])
    else:
        map_config["map_id"] = map_id
    return next_config


def reject_wrong_sim(state, data):
    if data.get("simId") != state.sim_id:
        try:
            send_event(state, EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, "Ignored message for invalid simulation.")
        except Exception:
            pass
        return True
    return False


def process_order_batch(state, batch):
    auto_dispatch = True
    if isinstance(batch, dict) and "autoDispatch" in batch:
        auto_dispatch = parse_bool(batch.get("autoDispatch"))
    elif isinstance(batch, dict) and "auto_dispatch" in batch:
        auto_dispatch = parse_bool(batch.get("auto_dispatch"))

    updates = state.world.receive_order_batch(batch, auto_dispatch=auto_dispatch)
    for order_dict in updates.get("orders", []):
        send_order_update(state, order_dict)
    for mission_dict in updates.get("missions", []):
        send_mission_update(state, mission_dict)
    drain_order_mission_updates(state)
    send_all_planned_paths(state)
    state.last_path_ids = mark_current_paths(state)
    send_order_state(state)
    drain_world_events(state)


def process_dispatch_orders(state):
    updates = state.world.dispatch_pending_orders()
    for order_dict in updates.get("orders", []):
        send_order_update(state, order_dict)
    for mission_dict in updates.get("missions", []):
        send_mission_update(state, mission_dict)
    drain_order_mission_updates(state)
    send_all_planned_paths(state)
    state.last_path_ids = mark_current_paths(state)
    send_order_state(state)
    drain_world_events(state)


def handle_registered(state, data):
    print(f"Worker registered voi broker: {data.get('clientId')}")


def handle_ping(state, data):
    state.ws.send(json.dumps({
        "type": "pong",
        "timestamp": data.get("timestamp"),
    }))


def handle_start_simulation(state, data):
    payload = data.get("payload") or {}
    state.sim_id = data.get("simId")
    state.frontend_id = data.get("frontendId")
    requested_map_id = payload.get("mapId") or payload.get("map_id")
    state.drone_count = clamp_int(payload.get("droneCount"), 1, state.max_demo_drones, state.default_demo_drones)
    state.shard_mode = parse_bool(payload.get("shardMode", payload.get("shard_mode", False)))
    state.shard_id = payload.get("shardId") or payload.get("shard_id")
    state.shard_index = clamp_int(payload.get("shardIndex", payload.get("shard_index", 0)), 0, 999, 0)
    state.shard_count = clamp_int(payload.get("shardCount", payload.get("shard_count", 1)), 1, 999, 1)
    state.drone_id_offset = clamp_int(payload.get("droneIdOffset", payload.get("drone_id_offset", 0)), 0, 100000, 0)
    state.global_drone_count = clamp_int(
        payload.get("globalDroneCount", payload.get("global_drone_count", state.drone_count)),
        1, 100000, state.drone_count,
    )
    altitude_band_index = clamp_int(
        payload.get("altitudeBandIndex", payload.get("altitude_band_index", state.shard_index)),
        0, 10, state.shard_index,
    )
    state.is_assigned = True
    state.is_running = False
    state.step = 0
    state.telemetry_counter = 0
    state.wind_shadow_requested = state.send_wind_shadow_by_default

    state.config = config_for_map(state.base_config, requested_map_id)
    if state.shard_mode:
        altitude_levels = state.config.get("performance", {}).get("altitude_levels", [20.0, 35.0, 50.0])
        if altitude_levels and state.config.get("drone") and "normal_altitude" in state.config["drone"]:
            band_altitude = altitude_levels[altitude_band_index % len(altitude_levels)]
            state.config["drone"]["normal_altitude"] = float(band_altitude)
    state.dt = state.config["simulation"]["time_step"]
    map_id = state.config.get("map", {}).get("map_id", _DEFAULT_MAP_ID)

    if state.config.get("performance", {}).get("require_map_cache", False) and not cache_exists(map_id):
        send_event(
            state,
            EventLevel.ERROR.value,
            EventCode.MAP_CACHE_MISSING.value,
            f"Map cache missing for mapId={map_id}. Build cache before demo.",
            SYSTEM_DRONE_ID,
        )
        send_simulation_finished(state, "failed")
        send_worker_status(state, "idle")
        state.is_assigned = False
        state.sim_id = None
        state.frontend_id = None
        return

    state.world = SimulationWorld(
        state.config,
        state.drone_count,
        idle_on_start=True,
        drone_id_offset=state.drone_id_offset,
    )
    state.transformer = Transformer.from_crs(state.world.graph.crs_utm, "epsg:4326", always_xy=True)
    state.last_path_ids = mark_current_paths(state)

    send_config(state)
    send_all_telemetry(state)
    startup_order_batch = payload.get("orderBatch", payload.get("order_batch", payload.get("orders")))
    if startup_order_batch is not None:
        if "autoDispatch" in payload or "auto_dispatch" in payload:
            startup_order_batch = {
                "orders": startup_order_batch,
                "autoDispatch": payload.get("autoDispatch", payload.get("auto_dispatch")),
            }
        process_order_batch(state, startup_order_batch)
        send_all_telemetry(state)
    else:
        send_event(
            state,
            EventLevel.INFO.value,
            EventCode.ORDER_STATE_UPDATED.value,
            "Simulation initialized. Waiting for order batch.",
            SYSTEM_DRONE_ID,
        )
    send_all_telemetry(state)
    if state.wind_shadow_requested:
        send_wind_shadow_zones(state)
    drain_world_events(state)
    state.is_running = True
    print(f"Bat dau simulation {state.sim_id} cho {state.frontend_id} voi {state.drone_count} drone, shard={state.shard_id or 'none'}")


def handle_add_obstacle(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    payload = data.get("payload") or {}
    pos = payload.get("pos") or data.get("pos")
    radius = payload.get("radius", 8.0)
    height = payload.get("height", 25.0)
    obstacle_type = payload.get("obstacleType", "unknown")
    if not pos:
        send_event(state, EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, "Obstacle message missing position.")
        return
    state.world.add_obstacle(pos, radius=radius, height=height, obstacle_type=obstacle_type)
    send_event(state, EventLevel.WARNING.value, EventCode.OBSTACLE_ADDED.value, "Obstacle added by user.")
    drain_world_events(state)


def handle_add_no_fly_zone(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    payload = data.get("payload") or {}
    center = payload.get("center") or payload.get("pos") or data.get("center") or data.get("pos")
    radius = payload.get("radius", 60.0)
    height = payload.get("height", state.config.get("drone", {}).get("max_altitude", 120.0))
    if not center:
        send_event(state, EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, "No-fly zone message missing center.")
        return

    before_path_ids = mark_current_paths(state)
    state.world.add_no_fly_zone(center, radius=radius, height=height)
    drain_order_mission_updates(state)
    for agent in state.world.get_agents():
        if id(agent.path) != before_path_ids.get(agent.drone_id):
            send_planned_path_for_agent(state, agent, include_empty=True)
            state.last_path_ids[agent.drone_id] = id(agent.path)
    send_all_telemetry(state)
    drain_world_events(state)


def handle_weather_update(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    payload = data.get("payload") or {}
    wind_dir = payload.get("wind_dir", data.get("wind_dir", state.world.wind_dir))
    wind_speed = payload.get("wind_speed", data.get("wind_speed", state.world.wind_speed))
    ambient_temp = payload.get("ambient_temp", data.get("ambient_temp", state.world.ambient_temp))
    rain_value = payload.get("is_raining", payload.get("rain", data.get("is_raining", data.get("rain", False))))
    was_running = state.is_running
    state.is_running = False
    state.world.update_weather(
        wind_dir=float(wind_dir),
        wind_speed=float(wind_speed),
        ambient_temp=float(ambient_temp),
        is_raining=parse_bool(rain_value),
        replan=True,
    )
    send_event(
        state,
        EventLevel.INFO.value,
        EventCode.WEATHER_CHANGED.value,
        (
            f"Weather changed: wind_to={state.world.wind_dir} deg, "
            f"speed={state.world.wind_speed} m/s, temp={state.world.ambient_temp} C, "
            f"rain={'on' if state.world.is_raining else 'off'}. Replanning paths."
        ),
        SYSTEM_DRONE_ID,
    )
    if state.wind_shadow_requested:
        send_wind_shadow_zones(state)
    send_all_planned_paths(state)
    send_all_telemetry(state)
    drain_world_events(state)
    state.last_path_ids = mark_current_paths(state)
    state.is_running = was_running


def handle_request_wind_shadow(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    state.wind_shadow_requested = True
    send_wind_shadow_zones(state)


def handle_order_batch(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    payload = data.get("payload") or {}
    if "orders" in payload or "autoDispatch" in payload or "auto_dispatch" in payload:
        batch = payload
    else:
        batch = payload.get("orderBatch") or payload
    process_order_batch(state, batch)


def handle_dispatch_orders(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    process_dispatch_orders(state)


def handle_command(state, data):
    if not state.is_assigned or reject_wrong_sim(state, data):
        return
    cmd = data.get("action")
    if cmd in ("start", "resume"):
        print("Da nhan lenh RESUME/START!")
        state.world.resume()
        state.is_running = True
        send_event(state, EventLevel.INFO.value, EventCode.SIMULATION_RESUMED.value, "Simulation resumed.")
        send_all_telemetry(state)
    elif cmd == "pause":
        print("Da nhan lenh PAUSE!")
        state.is_running = False
        state.world.pause()
        send_event(state, EventLevel.INFO.value, EventCode.SIMULATION_PAUSED.value, "Simulation paused.")
        send_all_telemetry(state)
    elif cmd == "reset":
        print("Da nhan lenh RESET!")
        state.is_running = False
        state.world.reset(state.drone_count)
        state.step = 0
        state.telemetry_counter = 0
        send_all_telemetry(state)
        if state.wind_shadow_requested:
            send_wind_shadow_zones(state)
        send_all_planned_paths(state, include_empty=True)
        send_order_state(state)
        drain_world_events(state)
        state.last_path_ids = mark_current_paths(state)
        state.is_running = True
    elif cmd == "stop":
        print("Da nhan lenh STOP!")
        state.is_running = False
        state.world.stop()
        send_all_telemetry(state, True)
        send_all_planned_paths(state, include_empty=True)
        drain_order_mission_updates(state)
        send_order_state(state)
        send_event(state, EventLevel.INFO.value, EventCode.SIMULATION_STOPPED.value, "Simulation stopped by operator.")
        send_simulation_finished(state, "stopped")
        send_worker_status(state, "idle")
        state.is_assigned = False
        state.sim_id = None
        state.frontend_id = None
