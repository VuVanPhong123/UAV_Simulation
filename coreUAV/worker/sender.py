import json
import math
import time

from physics.energy import rain_factor
from pathfinding.utils import path_point_altitude, path_point_node

SYSTEM_DRONE_ID = "system"
_DEFAULT_MAP_ID = "hanoi_my_dinh_me_tri_large"


def now_ms():
    return int(time.time() * 1000)


def sample_evenly(items, max_points):
    if max_points <= 0 or len(items) <= max_points:
        return items
    step = max(1, (len(items) + max_points - 1) // max_points)
    return items[::step][:max_points]


def _shard_metadata(state):
    if not state.shard_mode:
        return {}
    return {
        "shardId": state.shard_id,
        "shardIndex": state.shard_index,
        "shardCount": state.shard_count,
        "globalDroneCount": state.global_drone_count,
        "workerId": state.worker_name,
        "workerName": state.worker_name,
    }


def send_json(state, payload):
    message = dict(payload)
    message.update(_shard_metadata(state))
    state.ws.send(json.dumps(message))


def send_event(state, level, code, message, drone_id=SYSTEM_DRONE_ID):
    send_json(state, {
        "type": "event",
        "simId": state.sim_id,
        "droneId": drone_id,
        "timestamp": now_ms(),
        "payload": {
            "droneId": drone_id,
            "level": level,
            "code": code,
            "message": message,
        },
    })


def send_worker_status(state, status):
    send_json(state, {
        "type": "worker_status",
        "simId": state.sim_id,
        "status": status,
        "timestamp": now_ms(),
        "payload": {"status": status},
    })


def gps_for_node(state, node):
    x, y = state.world.graph.nodes[node]
    lon, lat = state.transformer.transform(x, y)
    return [lat, lon]


def map_bounds_payload(state):
    try:
        graph = state.world.graph
        min_x = float(graph.min_x)
        min_y = float(graph.min_y)
        max_x = min_x + (int(graph.cols) - 1) * float(graph.resolution)
        max_y = min_y + (int(graph.rows) - 1) * float(graph.resolution)
        corners = [(min_x, min_y), (min_x, max_y), (max_x, min_y), (max_x, max_y)]
        gps_corners = [state.transformer.transform(x, y) for x, y in corners]
        lons = [lon for lon, _lat in gps_corners]
        lats = [lat for _lon, lat in gps_corners]
        return {
            "south": min(lats),
            "west": min(lons),
            "north": max(lats),
            "east": max(lons),
        }
    except Exception:
        return None


def send_config(state):
    cfg = state.config
    map_id = cfg["map"].get("map_id", _DEFAULT_MAP_ID)
    drones = [
        {
            "droneId": agent.drone_id,
            "start": gps_for_node(state, agent.start_node),
            "goal": gps_for_node(state, agent.goal_node),
        }
        for agent in state.world.get_agents()
    ]
    payload = {
        "mapId": map_id,
        "mapLabel": cfg["map"].get("label", map_id),
        "buildingGeoJsonUrl": cfg["map"].get("building_geojson_url", f"/maps/{map_id}/buildings.geojson"),
        "droneCount": len(drones),
        "drones": drones,
        "depot": cfg["map"]["start_latlng"],
        "simulationMode": "order_dispatch",
        "hasFixedGoal": False,
        "start": cfg["map"]["start_latlng"],
        "goal": cfg["map"]["goal_latlng"],
        "charging_stations": cfg["map"].get("charging_stations_latlng", []),
        "no_fly_zones": cfg["map"].get("no_fly_zones", []),
        "safeOrderPoints": cfg["map"].get("safe_order_points", []),
    }
    bounds = map_bounds_payload(state)
    if bounds:
        payload["bounds"] = bounds
    send_json(state, {
        "type": "config",
        "simId": state.sim_id,
        "droneId": SYSTEM_DRONE_ID,
        "timestamp": now_ms(),
        "payload": payload,
        **payload,
    })


def agent_payload(state, agent, terminated=False):
    lon, lat = state.transformer.transform(agent.drone.pos[0], agent.drone.pos[1])
    return {
        "droneId": agent.drone_id,
        "pos": [lat, lon],
        "batteryPercent": float(agent.drone.battery),
        "altitude": float(agent.drone.altitude),
        "targetAltitude": float(agent.current_target_altitude),
        "altitudeChangeRate": float(agent.altitude_change_rate),
        "speed": float(
            agent.drone.speed
            * rain_factor(state.world.is_raining)["speed_factor"]
            * agent.temp_speed_factor
        ),
        "heading": float(agent.drone.heading),
        "temperature": float(agent.drone.temperature),
        "status": agent.drone.status,
        "mode": "delivery",
        "energyConsumed": float(agent.drone.max_battery - agent.drone.battery),
        "windDir": float(state.world.wind_dir),
        "windSpeed": float(state.world.wind_speed),
        "ambientTemp": float(state.world.ambient_temp),
        "isRaining": bool(state.world.is_raining),
        "currentPathIndex": int(agent.path_index),
        "pathLength": int(len(agent.path)),
        "currentOrderId": agent.current_order_id,
        "currentMissionId": agent.current_mission_id,
        "currentTargetType": agent.current_target_type,
        "payloadKg": float(agent.drone.payload_weight),
        "collisionState": agent.collision.state or "clear",
        "collisionPeerId": agent.collision.peer_id,
        "collisionDistanceM": agent.collision.distance_m,
        "collisionAction": agent.collision.action,
        "collisionAvoidanceReason": agent.collision.avoidance_reason,
        "step": state.step,
        "terminated": terminated,
    }


def send_telemetry_for_agent(state, agent, terminated=False):
    payload = agent_payload(state, agent, terminated)
    send_json(state, {
        "type": "telemetry",
        "simId": state.sim_id,
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
        "terminated": payload["terminated"],
    })


def send_all_telemetry(state, terminated=False):
    if state.world is None or state.transformer is None:
        return
    for agent in state.world.get_agents():
        if agent.drone.pos is not None:
            send_telemetry_for_agent(state, agent, terminated)


def send_wind_shadow_zones(state):
    if state.world is None or state.transformer is None:
        return
    shadow_gps = []
    if state.world.wind_speed > 0:
        shadow_utm = state.world.graph.get_wind_shadow_nodes(
            state.world.wind_dir,
            state.config["drone"]["normal_altitude"],
        )
        shadow_utm = sample_evenly(shadow_utm, state.wind_shadow_max_points)
        for x, y in shadow_utm:
            lon, lat = state.transformer.transform(x, y)
            shadow_gps.append([lat, lon])
    send_json(state, {
        "type": "wind_shadow_zones",
        "simId": state.sim_id,
        "droneId": SYSTEM_DRONE_ID,
        "timestamp": now_ms(),
        "payload": {"zones": shadow_gps},
        "zones": shadow_gps,
    })


def planned_path_payload(state, agent):
    def distance_m(a, b):
        return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))

    gps_path = []
    gps_path3d = []

    def append_utm_point(utm_pos, altitude):
        lon, lat = state.transformer.transform(utm_pos[0], utm_pos[1])
        gps_pos = [lat, lon]
        gps_path.append(gps_pos)
        gps_path3d.append({"pos": gps_pos, "altitude": float(altitude)})

    if agent.drone.pos:
        append_utm_point(agent.drone.pos, agent.drone.altitude)

    start_index = agent.path_index
    if agent.drone.pos is not None and start_index < len(agent.path) - 1:
        start_index += 1

    for point in agent.path[start_index:]:
        node = path_point_node(point)
        altitude = path_point_altitude(point, agent.drone.altitude)
        x, y = state.world.graph.nodes[node]
        if agent.drone.pos is not None and gps_path and distance_m(agent.drone.pos, (x, y)) <= 1.0:
            continue
        append_utm_point((x, y), altitude)

    return {"droneId": agent.drone_id, "path": gps_path, "path3d": gps_path3d}


def send_planned_path_for_agent(state, agent, include_empty=False):
    if not agent.path and not include_empty:
        return
    payload = planned_path_payload(state, agent)
    send_json(state, {
        "type": "planned_path",
        "simId": state.sim_id,
        "droneId": agent.drone_id,
        "timestamp": now_ms(),
        "payload": payload,
        "path": payload["path"],
        "path3d": payload["path3d"],
    })


def send_all_planned_paths(state, include_empty=False):
    if state.world is None or state.transformer is None:
        return
    for agent in state.world.get_agents():
        send_planned_path_for_agent(state, agent, include_empty=include_empty)


def send_simulation_finished(state, status):
    send_json(state, {
        "type": "simulation_finished",
        "simId": state.sim_id,
        "droneId": SYSTEM_DRONE_ID,
        "timestamp": now_ms(),
        "payload": {"status": status},
    })


def send_order_update(state, order_dict):
    send_json(state, {
        "type": "order_update",
        "simId": state.sim_id,
        "droneId": SYSTEM_DRONE_ID,
        "timestamp": now_ms(),
        "payload": order_dict,
    })


def send_order_state(state):
    if state.world is None:
        return
    send_json(state, {
        "type": "order_state",
        "simId": state.sim_id,
        "droneId": SYSTEM_DRONE_ID,
        "timestamp": now_ms(),
        "payload": state.world.get_order_state(),
    })


def send_mission_update(state, mission_dict):
    send_json(state, {
        "type": "mission_update",
        "simId": state.sim_id,
        "droneId": SYSTEM_DRONE_ID,
        "timestamp": now_ms(),
        "payload": mission_dict,
    })


def drain_world_events(state):
    if state.world is None:
        return
    for evt in state.world.drain_events():
        send_event(state, evt["level"], evt["code"], evt["message"], evt.get("droneId", SYSTEM_DRONE_ID))


def drain_order_mission_updates(state):
    if state.world is None:
        return
    for order_dict in state.world.drain_order_updates():
        send_order_update(state, order_dict)
    for mission_dict in state.world.drain_mission_updates():
        send_mission_update(state, mission_dict)


def mark_current_paths(state):
    return {agent.drone_id: id(agent.path) for agent in state.world.get_agents()}
