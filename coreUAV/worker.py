import copy
import json
import math
import os
import time

import websocket
import yaml
from pyproj import Transformer
from websocket import create_connection

from energy_model import rain_factor
from graph_map import path_point_altitude, path_point_node
from map_cache import MapCacheError, cache_exists
from simulation_world import SimulationWorld
from statuses import DroneStatus, EventCode, EventLevel

WS_URL = "ws://localhost:8080"
SYSTEM_DRONE_ID = "system"
DEFAULT_TELEMETRY_EVERY_N_STEPS = 5
DEFAULT_MAP_ID = "hanoi_my_dinh_me_tri_large"
DEFAULT_DEMO_DRONES = 5
DEFAULT_MAX_DEMO_DRONES = 15
DEFAULT_WIND_SHADOW_MAX_POINTS = 400


def now_ms():
    return int(time.time() * 1000)


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


WORKER_NAME = os.getenv("WORKER_NAME", f"local-worker-{os.getpid()}")
WORKER_MAX_DRONES = clamp_int(os.getenv("WORKER_MAX_DRONES"), 1, DEFAULT_MAX_DEMO_DRONES, DEFAULT_MAX_DEMO_DRONES)
WORKER_SUPPORTS_SHARDING = parse_bool(os.getenv("WORKER_SUPPORTS_SHARDING", "true"))


def sample_evenly(items, max_points):
    if max_points <= 0 or len(items) <= max_points:
        return items
    step = max(1, (len(items) + max_points - 1) // max_points)
    return items[::step][:max_points]


def config_for_map(base_config, requested_map_id=None):
    next_config = copy.deepcopy(base_config)
    map_config = next_config.setdefault("map", {})
    presets = map_config.get("presets", {})
    map_id = requested_map_id or map_config.get("map_id") or DEFAULT_MAP_ID
    if map_id != DEFAULT_MAP_ID:
        map_id = DEFAULT_MAP_ID
    if map_id not in presets:
        map_id = DEFAULT_MAP_ID
    preset = presets.get(map_id)
    if preset:
        map_config["map_id"] = preset.get("mapId", map_id)
        map_config["label"] = preset.get("label", map_config.get("label", map_id))
        for key in ("start_latlng", "goal_latlng", "charging_stations_latlng", "no_fly_zones", "safe_order_points", "building_geojson_url", "bounds"):
            if key in preset:
                map_config[key] = copy.deepcopy(preset[key])
        if "grid_resolution" in preset:
            next_config.setdefault("performance", {})["grid_resolution"] = float(preset["grid_resolution"])
        if "altitude_levels" in preset:
            next_config.setdefault("performance", {})["altitude_levels"] = copy.deepcopy(preset["altitude_levels"])
    else:
        map_config["map_id"] = map_id
    return next_config


def main():
    print("Dang ket noi toi Simulation Broker...")
    ws = create_connection(WS_URL)
    ws.settimeout(0.01)
    ws.send(json.dumps({
        "type": "register",
        "role": "worker",
        "workerName": WORKER_NAME,
        "metadata": {
            "workerName": WORKER_NAME,
            "capabilities": ["simulation", "order_dispatch", "large_map", "sharded_simulation"],
            "maxDrones": WORKER_MAX_DRONES,
            "supportsSharding": WORKER_SUPPORTS_SHARDING,
            "supportsCustomMap": False,
            "currentMapId": DEFAULT_MAP_ID,
            "pid": os.getpid()
        }
    }))
    print("Da ket noi va gui register worker!")

    with open("config.yaml", "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    base_config = copy.deepcopy(config)
    performance_config = config.get("performance", {})
    max_demo_drones = clamp_int(
        performance_config.get("max_demo_drones"),
        1,
        DEFAULT_MAX_DEMO_DRONES,
        DEFAULT_MAX_DEMO_DRONES
    )
    max_demo_drones = min(max_demo_drones, WORKER_MAX_DRONES)
    default_demo_drones = clamp_int(
        performance_config.get("default_demo_drones"),
        1,
        max_demo_drones,
        DEFAULT_DEMO_DRONES
    )
    wind_shadow_max_points = clamp_int(
        performance_config.get("wind_shadow_max_points"),
        0,
        2000,
        DEFAULT_WIND_SHADOW_MAX_POINTS
    )
    telemetry_every_n_steps = max(
        1,
        int(performance_config.get("telemetry_every_n_steps", DEFAULT_TELEMETRY_EVERY_N_STEPS))
    )
    send_wind_shadow_by_default = bool(performance_config.get("send_wind_shadow_by_default", False))

    world = None
    transformer = None
    sim_id = None
    frontend_id = None
    is_assigned = False
    is_running = False
    step = 0
    telemetry_counter = 0
    drone_count = 1
    shard_mode = False
    shard_id = None
    shard_index = 0
    shard_count = 1
    drone_id_offset = 0
    global_drone_count = 1
    last_path_ids = {}
    dt = config["simulation"]["time_step"]
    wind_shadow_requested = send_wind_shadow_by_default

    def current_sim_id():
        return sim_id

    def shard_metadata():
        if not shard_mode:
            return {}
        return {
            "shardId": shard_id,
            "shardIndex": shard_index,
            "shardCount": shard_count,
            "globalDroneCount": global_drone_count,
            "workerId": WORKER_NAME,
            "workerName": WORKER_NAME
        }

    def send_json(payload):
        message = dict(payload)
        message.update(shard_metadata())
        ws.send(json.dumps(message))

    def send_event(level, code, message, drone_id=SYSTEM_DRONE_ID):
        send_json({
            "type": "event",
            "simId": current_sim_id(),
            "droneId": drone_id,
            "timestamp": now_ms(),
            "payload": {
                "droneId": drone_id,
                "level": level,
                "code": code,
                "message": message
            }
        })

    def send_worker_status(status):
        send_json({
            "type": "worker_status",
            "simId": current_sim_id(),
            "status": status,
            "timestamp": now_ms(),
            "payload": {
                "status": status
            }
        })

    def gps_for_node(node):
        x, y = world.graph.nodes[node]
        lon, lat = transformer.transform(x, y)
        return [lat, lon]

    def map_bounds_payload():
        try:
            graph = world.graph
            min_x = float(graph.min_x)
            min_y = float(graph.min_y)
            max_x = min_x + (int(graph.cols) - 1) * float(graph.resolution)
            max_y = min_y + (int(graph.rows) - 1) * float(graph.resolution)
            corners = [
                (min_x, min_y),
                (min_x, max_y),
                (max_x, min_y),
                (max_x, max_y)
            ]
            gps_corners = [transformer.transform(x, y) for x, y in corners]
            lons = [lon for lon, _lat in gps_corners]
            lats = [lat for _lon, lat in gps_corners]
            return {
                "south": min(lats),
                "west": min(lons),
                "north": max(lats),
                "east": max(lons)
            }
        except Exception:
            return None

    def send_config():
        drones = [
            {
                "droneId": agent.drone_id,
                "start": gps_for_node(agent.start_node),
                "goal": gps_for_node(agent.goal_node)
            }
            for agent in world.get_agents()
        ]
        payload = {
            "mapId": config["map"].get("map_id", DEFAULT_MAP_ID),
            "mapLabel": config["map"].get("label", config["map"].get("map_id", DEFAULT_MAP_ID)),
            "buildingGeoJsonUrl": config["map"].get("building_geojson_url", f"/maps/{config['map'].get('map_id', DEFAULT_MAP_ID)}/buildings.geojson"),
            "droneCount": len(drones),
            "drones": drones,
            "depot": config["map"]["start_latlng"],
            "simulationMode": "order_dispatch",
            "hasFixedGoal": False,
            "start": config["map"]["start_latlng"],
            "goal": config["map"]["goal_latlng"],
            "charging_stations": config["map"].get("charging_stations_latlng", []),
            "no_fly_zones": config["map"].get("no_fly_zones", []),
            "safeOrderPoints": config["map"].get("safe_order_points", [])
        }
        bounds = map_bounds_payload()
        if bounds:
            payload["bounds"] = bounds
        send_json({
            "type": "config",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": payload,
            **payload
        })

    def agent_payload(agent, terminated=False):
        lon, lat = transformer.transform(agent.drone.pos[0], agent.drone.pos[1])
        return {
            "droneId": agent.drone_id,
            "pos": [lat, lon],
            "batteryPercent": float(agent.drone.battery),
            "altitude": float(agent.drone.altitude),
            "targetAltitude": float(agent.current_target_altitude),
            "altitudeChangeRate": float(agent.altitude_change_rate),
            "speed": float(agent.drone.speed * rain_factor(world.is_raining)["speed_factor"] * agent.temp_speed_factor),
            "heading": float(agent.drone.heading),
            "temperature": float(agent.drone.temperature),
            "status": agent.drone.status,
            "mode": "delivery",
            "energyConsumed": float(agent.drone.max_battery - agent.drone.battery),
            "windDir": float(world.wind_dir),
            "windSpeed": float(world.wind_speed),
            "ambientTemp": float(world.ambient_temp),
            "isRaining": bool(world.is_raining),
            "currentPathIndex": int(agent.path_index),
            "pathLength": int(len(agent.path)),
            "currentOrderId": agent.current_order_id,
            "currentMissionId": agent.current_mission_id,
            "currentTargetType": agent.current_target_type,
            "payloadKg": float(agent.drone.payload_weight),
            "collisionState": agent.collision_state or "clear",
            "collisionPeerId": agent.collision_peer_id,
            "collisionDistanceM": agent.collision_distance_m,
            "collisionAction": agent.collision_action,
            "collisionAvoidanceReason": agent.collision_avoidance_reason,
            "step": step,
            "terminated": terminated
        }

    def send_telemetry_for_agent(agent, terminated=False):
        payload = agent_payload(agent, terminated)
        send_json({
            "type": "telemetry",
            "simId": current_sim_id(),
            "droneId": agent.drone_id,
            "timestamp": now_ms(),
            "payload": payload,
            "step": payload["step"],
            "pos": payload["pos"],
            "battery": payload["batteryPercent"],
            "batteryPercent": payload["batteryPercent"],
            "altitude": payload["altitude"],
            "targetAltitude": payload["targetAltitude"],
            "altitudeChangeRate": payload["altitudeChangeRate"],
            "speed": payload["speed"],
            "heading": payload["heading"],
            "temperature": payload["temperature"],
            "status": payload["status"],
            "windDir": payload["windDir"],
            "windSpeed": payload["windSpeed"],
            "ambientTemp": payload["ambientTemp"],
            "isRaining": payload["isRaining"],
            "currentPathIndex": payload["currentPathIndex"],
            "pathLength": payload["pathLength"],
            "currentOrderId": payload["currentOrderId"],
            "currentMissionId": payload["currentMissionId"],
            "currentTargetType": payload["currentTargetType"],
            "payloadKg": payload["payloadKg"],
            "collisionState": payload["collisionState"],
            "collisionPeerId": payload["collisionPeerId"],
            "collisionDistanceM": payload["collisionDistanceM"],
            "collisionAction": payload["collisionAction"],
            "collisionAvoidanceReason": payload["collisionAvoidanceReason"],
            "terminated": payload["terminated"]
        })

    def send_all_telemetry(terminated=False):
        if world is None or transformer is None:
            return
        for agent in world.get_agents():
            if agent.drone.pos is not None:
                send_telemetry_for_agent(agent, terminated)

    def send_wind_shadow_zones():
        if world is None or transformer is None:
            return

        shadow_gps = []
        if world.wind_speed > 0:
            shadow_utm = world.graph.get_wind_shadow_nodes(world.wind_dir, config["drone"]["normal_altitude"])
            shadow_utm = sample_evenly(shadow_utm, wind_shadow_max_points)
            for (x, y) in shadow_utm:
                lon, lat = transformer.transform(x, y)
                shadow_gps.append([lat, lon])
        send_json({
            "type": "wind_shadow_zones",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": {
                "zones": shadow_gps
            },
            "zones": shadow_gps
        })

    def planned_path_payload(agent):
        def distance_m(a, b):
            return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))

        def append_utm_point(utm_pos, altitude):
            lon, lat = transformer.transform(utm_pos[0], utm_pos[1])
            gps_pos = [lat, lon]
            gps_path.append(gps_pos)
            gps_path3d.append({
                "pos": gps_pos,
                "altitude": float(altitude)
            })

        gps_path = []
        gps_path3d = []
        if agent.drone.pos:
            append_utm_point(agent.drone.pos, agent.drone.altitude)

        start_index = agent.path_index
        if agent.drone.pos is not None and start_index < len(agent.path) - 1:
            start_index += 1

        for point in agent.path[start_index:]:
            node = path_point_node(point)
            altitude = path_point_altitude(point, agent.drone.altitude)
            x, y = world.graph.nodes[node]
            if agent.drone.pos is not None and gps_path and distance_m(agent.drone.pos, (x, y)) <= 1.0:
                continue
            append_utm_point((x, y), altitude)
        return {
            "droneId": agent.drone_id,
            "path": gps_path,
            "path3d": gps_path3d
        }

    def send_planned_path_for_agent(agent, include_empty=False):
        if not agent.path and not include_empty:
            return
        payload = planned_path_payload(agent)
        send_json({
            "type": "planned_path",
            "simId": current_sim_id(),
            "droneId": agent.drone_id,
            "timestamp": now_ms(),
            "payload": payload,
            "path": payload["path"],
            "path3d": payload["path3d"]
        })

    def send_all_planned_paths(include_empty=False):
        if world is None or transformer is None:
            return
        for agent in world.get_agents():
            send_planned_path_for_agent(agent, include_empty=include_empty)

    def send_simulation_finished(status):
        send_json({
            "type": "simulation_finished",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": {
                "status": status
            }
        })

    def send_order_update(order_dict):
        send_json({
            "type": "order_update",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": order_dict
        })

    def send_order_state():
        if world is None:
            return
        send_json({
            "type": "order_state",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": world.get_order_state()
        })

    def send_mission_update(mission_dict):
        send_json({
            "type": "mission_update",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": mission_dict
        })

    def drain_world_events():
        if world is None:
            return
        for evt in world.drain_events():
            send_event(evt["level"], evt["code"], evt["message"], evt.get("droneId", SYSTEM_DRONE_ID))

    def drain_order_mission_updates():
        if world is None:
            return
        for order_dict in world.drain_order_updates():
            send_order_update(order_dict)
        for mission_dict in world.drain_mission_updates():
            send_mission_update(mission_dict)

    def reject_wrong_sim(data):
        if data.get("simId") != sim_id:
            try:
                send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, "Ignored message for invalid simulation.")
            except Exception:
                pass
            return True
        return False

    def mark_current_paths():
        return {
            agent.drone_id: id(agent.path)
            for agent in world.get_agents()
        }

    def process_order_batch(batch):
        nonlocal last_path_ids
        auto_dispatch = True
        if isinstance(batch, dict) and "autoDispatch" in batch:
            auto_dispatch = parse_bool(batch.get("autoDispatch"))
        elif isinstance(batch, dict) and "auto_dispatch" in batch:
            auto_dispatch = parse_bool(batch.get("auto_dispatch"))

        updates = world.receive_order_batch(batch, auto_dispatch=auto_dispatch)
        for order_dict in updates.get("orders", []):
            send_order_update(order_dict)
        for mission_dict in updates.get("missions", []):
            send_mission_update(mission_dict)
        drain_order_mission_updates()
        send_all_planned_paths()
        last_path_ids = mark_current_paths()
        send_order_state()
        drain_world_events()

    def process_dispatch_orders():
        nonlocal last_path_ids
        updates = world.dispatch_pending_orders()
        for order_dict in updates.get("orders", []):
            send_order_update(order_dict)
        for mission_dict in updates.get("missions", []):
            send_mission_update(mission_dict)
        drain_order_mission_updates()
        send_all_planned_paths()
        last_path_ids = mark_current_paths()
        send_order_state()
        drain_world_events()

    print("\nWorker DA SAN SANG, dang cho start_simulation...\n")

    while True:
        try:
            msg = ws.recv()
            data = json.loads(msg)
            msg_type = data.get("type")

            if msg_type == "registered":
                print(f"Worker registered voi broker: {data.get('clientId')}")

            elif msg_type == "ping":
                ws.send(json.dumps({
                    "type": "pong",
                    "timestamp": data.get("timestamp")
                }))

            elif msg_type == "start_simulation":
                payload = data.get("payload") or {}
                sim_id = data.get("simId")
                frontend_id = data.get("frontendId")
                requested_map_id = payload.get("mapId") or payload.get("map_id")
                drone_count = clamp_int(payload.get("droneCount"), 1, max_demo_drones, default_demo_drones)
                shard_mode = parse_bool(payload.get("shardMode", payload.get("shard_mode", False)))
                shard_id = payload.get("shardId") or payload.get("shard_id")
                shard_index = clamp_int(payload.get("shardIndex", payload.get("shard_index", 0)), 0, 999, 0)
                shard_count = clamp_int(payload.get("shardCount", payload.get("shard_count", 1)), 1, 999, 1)
                drone_id_offset = clamp_int(payload.get("droneIdOffset", payload.get("drone_id_offset", 0)), 0, 100000, 0)
                global_drone_count = clamp_int(payload.get("globalDroneCount", payload.get("global_drone_count", drone_count)), 1, 100000, drone_count)
                altitude_band_index = clamp_int(payload.get("altitudeBandIndex", payload.get("altitude_band_index", shard_index)), 0, 10, shard_index)
                is_assigned = True
                is_running = False
                step = 0
                telemetry_counter = 0
                wind_shadow_requested = send_wind_shadow_by_default

                config = config_for_map(base_config, requested_map_id)
                if shard_mode:
                    altitude_levels = config.get("performance", {}).get("altitude_levels", [20.0, 35.0, 50.0])
                    if altitude_levels and config.get("drone") and "normal_altitude" in config["drone"]:
                        band_altitude = altitude_levels[altitude_band_index % len(altitude_levels)]
                        config["drone"]["normal_altitude"] = float(band_altitude)
                dt = config["simulation"]["time_step"]
                map_id = config.get("map", {}).get("map_id", DEFAULT_MAP_ID)
                if config.get("performance", {}).get("require_map_cache", False) and not cache_exists(map_id):
                    send_event(
                        EventLevel.ERROR.value,
                        EventCode.MAP_CACHE_MISSING.value,
                        f"Map cache missing for mapId={map_id}. Build cache before demo.",
                        SYSTEM_DRONE_ID,
                    )
                    send_simulation_finished("failed")
                    send_worker_status("idle")
                    is_assigned = False
                    sim_id = None
                    frontend_id = None
                    continue

                world = SimulationWorld(
                    config,
                    drone_count,
                    idle_on_start=True,
                    drone_id_offset=drone_id_offset
                )
                transformer = Transformer.from_crs(world.graph.crs_utm, "epsg:4326", always_xy=True)
                last_path_ids = mark_current_paths()

                send_config()
                send_all_telemetry()
                startup_order_batch = payload.get("orderBatch", payload.get("order_batch", payload.get("orders")))
                if startup_order_batch is not None:
                    if "autoDispatch" in payload or "auto_dispatch" in payload:
                        startup_order_batch = {
                            "orders": startup_order_batch,
                            "autoDispatch": payload.get("autoDispatch", payload.get("auto_dispatch"))
                        }
                    process_order_batch(startup_order_batch)
                    send_all_telemetry()
                else:
                    send_event(
                        EventLevel.INFO.value,
                        EventCode.ORDER_STATE_UPDATED.value,
                        "Simulation initialized. Waiting for order batch.",
                        SYSTEM_DRONE_ID
                    )
                send_all_telemetry()
                if wind_shadow_requested:
                    send_wind_shadow_zones()
                drain_world_events()
                is_running = True
                print(f"Bat dau simulation {sim_id} cho {frontend_id} voi {drone_count} drone, shard={shard_id or 'none'}")

            elif msg_type == "add_obstacle":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                payload = data.get("payload") or {}
                pos = payload.get("pos") or data.get("pos")
                radius = payload.get("radius", 8.0)
                height = payload.get("height", 25.0)
                obstacle_type = payload.get("obstacleType", "unknown")
                if not pos:
                    send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, "Obstacle message missing position.")
                    continue
                world.add_obstacle(pos, radius=radius, height=height, obstacle_type=obstacle_type)
                send_event(EventLevel.WARNING.value, EventCode.OBSTACLE_ADDED.value, "Obstacle added by user.")
                drain_world_events()

            elif msg_type == "add_no_fly_zone":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                payload = data.get("payload") or {}
                center = payload.get("center") or payload.get("pos") or data.get("center") or data.get("pos")
                radius = payload.get("radius", 60.0)
                height = payload.get("height", config.get("drone", {}).get("max_altitude", 120.0))
                if not center:
                    send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, "No-fly zone message missing center.")
                    continue

                before_path_ids = mark_current_paths()
                world.add_no_fly_zone(center, radius=radius, height=height)
                drain_order_mission_updates()
                for agent in world.get_agents():
                    if id(agent.path) != before_path_ids.get(agent.drone_id):
                        send_planned_path_for_agent(agent, include_empty=True)
                        last_path_ids[agent.drone_id] = id(agent.path)
                send_all_telemetry()
                drain_world_events()

            elif msg_type == "weather_update":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                payload = data.get("payload") or {}
                wind_dir = payload.get("wind_dir", data.get("wind_dir", world.wind_dir))
                wind_speed = payload.get("wind_speed", data.get("wind_speed", world.wind_speed))
                ambient_temp = payload.get("ambient_temp", data.get("ambient_temp", world.ambient_temp))
                rain_value = payload.get("is_raining", payload.get("rain", data.get("is_raining", data.get("rain", False))))
                was_running = is_running
                is_running = False
                world.update_weather(
                    wind_dir=float(wind_dir),
                    wind_speed=float(wind_speed),
                    ambient_temp=float(ambient_temp),
                    is_raining=parse_bool(rain_value),
                    replan=True
                )
                send_event(
                    EventLevel.INFO.value,
                    EventCode.WEATHER_CHANGED.value,
                    f"Weather changed: wind_to={world.wind_dir} deg, speed={world.wind_speed} m/s, temp={world.ambient_temp} C, rain={'on' if world.is_raining else 'off'}. Replanning paths.",
                    SYSTEM_DRONE_ID
                )
                if wind_shadow_requested:
                    send_wind_shadow_zones()
                send_all_planned_paths()
                send_all_telemetry()
                drain_world_events()
                last_path_ids = mark_current_paths()
                is_running = was_running

            elif msg_type == "request_wind_shadow":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                wind_shadow_requested = True
                send_wind_shadow_zones()

            elif msg_type == "order_batch":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                payload = data.get("payload") or {}
                if "orders" in payload or "autoDispatch" in payload or "auto_dispatch" in payload:
                    batch = payload
                else:
                    batch = payload.get("orderBatch") or payload
                process_order_batch(batch)

            elif msg_type == "dispatch_orders":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                process_dispatch_orders()

            elif msg_type == "command":
                if not is_assigned or reject_wrong_sim(data):
                    continue
                cmd = data.get("action")
                if cmd in ("start", "resume"):
                    print("Da nhan lenh RESUME/START!")
                    world.resume()
                    is_running = True
                    send_event(EventLevel.INFO.value, EventCode.SIMULATION_RESUMED.value, "Simulation resumed.")
                    send_all_telemetry()
                elif cmd == "pause":
                    print("Da nhan lenh PAUSE!")
                    is_running = False
                    world.pause()
                    send_event(EventLevel.INFO.value, EventCode.SIMULATION_PAUSED.value, "Simulation paused.")
                    send_all_telemetry()
                elif cmd == "reset":
                    print("Da nhan lenh RESET!")
                    is_running = False
                    world.reset(drone_count)
                    step = 0
                    telemetry_counter = 0
                    send_all_telemetry()
                    if wind_shadow_requested:
                        send_wind_shadow_zones()
                    send_all_planned_paths(include_empty=True)
                    send_order_state()
                    drain_world_events()
                    last_path_ids = mark_current_paths()
                    is_running = True
                elif cmd == "stop":
                    print("Da nhan lenh STOP!")
                    is_running = False
                    world.stop()
                    send_all_telemetry(True)
                    send_all_planned_paths(include_empty=True)
                    drain_order_mission_updates()
                    send_order_state()
                    send_event(EventLevel.INFO.value, EventCode.SIMULATION_STOPPED.value, "Simulation stopped by operator.")
                    send_simulation_finished("stopped")
                    send_worker_status("idle")
                    is_assigned = False
                    sim_id = None
                    frontend_id = None

        except websocket.WebSocketTimeoutException:
            pass
        except Exception as e:
            print(f"[Worker Error] {e}")
            try:
                send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, str(e))
            except Exception:
                pass

        if is_running and world is not None:
            try:
                world.step()
                step += 1
                drain_world_events()
                drain_order_mission_updates()
                telemetry_counter += 1
                if telemetry_counter >= telemetry_every_n_steps:
                    send_all_telemetry()
                    telemetry_counter = 0

                current_path_ids = mark_current_paths()
                for agent in world.get_agents():
                    if current_path_ids.get(agent.drone_id) != last_path_ids.get(agent.drone_id):
                        print(f"   [Worker] Path changed for {agent.drone_id}, sending update...")
                        send_planned_path_for_agent(agent)
                        last_path_ids[agent.drone_id] = current_path_ids.get(agent.drone_id)

                time.sleep(dt)
            except Exception as e:
                print(f"[Worker Error] {e}")
                if world is not None:
                    world.stop()
                try:
                    send_all_telemetry(True)
                    send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, str(e))
                    send_simulation_finished("failed")
                    send_worker_status("idle")
                except Exception:
                    pass
                is_running = False
                is_assigned = False
                sim_id = None
                frontend_id = None
        else:
            time.sleep(0.05)


if __name__ == "__main__":
    main()
