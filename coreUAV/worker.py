import json
import time

import websocket
import yaml
from pyproj import Transformer
from websocket import create_connection

from energy_model import rain_factor
from graph_map import path_point_altitude, path_point_node
from simulation_world import SimulationWorld
from statuses import DroneStatus, EventCode, EventLevel

WS_URL = "ws://localhost:8080"
SYSTEM_DRONE_ID = "system"
DEFAULT_TELEMETRY_EVERY_N_STEPS = 5


def now_ms():
    return int(time.time() * 1000)


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def main():
    print("Dang ket noi toi Simulation Broker...")
    ws = create_connection(WS_URL)
    ws.settimeout(0.01)
    ws.send(json.dumps({
        "type": "register",
        "role": "worker"
    }))
    print("Da ket noi va gui register worker!")

    with open("config.yaml", "r") as f:
        config = yaml.safe_load(f)
    performance_config = config.get("performance", {})
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
    last_path_ids = {}
    dt = config["simulation"]["time_step"]

    def current_sim_id():
        return sim_id

    def send_event(level, code, message, drone_id=SYSTEM_DRONE_ID):
        ws.send(json.dumps({
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
        }))

    def send_worker_status(status):
        ws.send(json.dumps({
            "type": "worker_status",
            "simId": current_sim_id(),
            "timestamp": now_ms(),
            "payload": {
                "status": status
            }
        }))

    def gps_for_node(node):
        x, y = world.graph.nodes[node]
        lon, lat = transformer.transform(x, y)
        return [lat, lon]

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
            "droneCount": len(drones),
            "drones": drones,
            "start": config["map"]["start_latlng"],
            "goal": config["map"]["goal_latlng"],
            "charging_stations": config["map"].get("charging_stations_latlng", []),
            "no_fly_zones": config["map"].get("no_fly_zones", [])
        }
        ws.send(json.dumps({
            "type": "config",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": payload,
            **payload
        }))

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
            "step": step,
            "terminated": terminated
        }

    def send_telemetry_for_agent(agent, terminated=False):
        payload = agent_payload(agent, terminated)
        ws.send(json.dumps({
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
            "terminated": payload["terminated"]
        }))

    def send_all_telemetry(terminated=False):
        if world is None or transformer is None:
            return
        for agent in world.get_agents():
            if agent.drone.pos is not None:
                send_telemetry_for_agent(agent, terminated)

    def send_wind_shadow_zones():
        if world is None or transformer is None:
            return

        shadow_utm = world.graph.get_wind_shadow_nodes(world.wind_dir, config["drone"]["normal_altitude"])
        shadow_gps = []
        for (x, y) in shadow_utm:
            lon, lat = transformer.transform(x, y)
            shadow_gps.append([lat, lon])
        ws.send(json.dumps({
            "type": "wind_shadow_zones",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": {
                "zones": shadow_gps
            },
            "zones": shadow_gps
        }))

    def planned_path_payload(agent):
        gps_path = []
        gps_path3d = []
        if agent.drone.pos:
            lon_d, lat_d = transformer.transform(agent.drone.pos[0], agent.drone.pos[1])
            gps_path.append([lat_d, lon_d])
            gps_path3d.append({
                "pos": [lat_d, lon_d],
                "altitude": float(agent.drone.altitude)
            })

        for point in agent.path[agent.path_index:]:
            node = path_point_node(point)
            altitude = path_point_altitude(point, agent.drone.altitude)
            x, y = world.graph.nodes[node]
            lon, lat = transformer.transform(x, y)
            gps_path.append([lat, lon])
            gps_path3d.append({
                "pos": [lat, lon],
                "altitude": float(altitude)
            })
        return {
            "droneId": agent.drone_id,
            "path": gps_path,
            "path3d": gps_path3d
        }

    def send_planned_path_for_agent(agent):
        if not agent.path:
            return
        payload = planned_path_payload(agent)
        ws.send(json.dumps({
            "type": "planned_path",
            "simId": current_sim_id(),
            "droneId": agent.drone_id,
            "timestamp": now_ms(),
            "payload": payload,
            "path": payload["path"],
            "path3d": payload["path3d"]
        }))

    def send_all_planned_paths():
        if world is None or transformer is None:
            return
        for agent in world.get_agents():
            send_planned_path_for_agent(agent)

    def send_simulation_finished(status):
        ws.send(json.dumps({
            "type": "simulation_finished",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": {
                "status": status
            }
        }))

    def send_order_update(order_dict):
        ws.send(json.dumps({
            "type": "order_update",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": order_dict
        }))

    def send_order_state():
        if world is None:
            return
        ws.send(json.dumps({
            "type": "order_state",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": world.get_order_state()
        }))

    def send_mission_update(mission_dict):
        ws.send(json.dumps({
            "type": "mission_update",
            "simId": current_sim_id(),
            "droneId": SYSTEM_DRONE_ID,
            "timestamp": now_ms(),
            "payload": mission_dict
        }))

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
                drone_count = max(1, min(5, int(payload.get("droneCount", 1) or 1)))
                is_assigned = True
                is_running = False
                step = 0
                telemetry_counter = 0

                world = SimulationWorld(config, drone_count)
                transformer = Transformer.from_crs(world.graph.crs_utm, "epsg:4326", always_xy=True)
                last_path_ids = mark_current_paths()

                send_config()
                startup_order_batch = payload.get("orderBatch", payload.get("order_batch"))
                if startup_order_batch is not None:
                    if "autoDispatch" in payload or "auto_dispatch" in payload:
                        startup_order_batch = {
                            "orders": startup_order_batch,
                            "autoDispatch": payload.get("autoDispatch", payload.get("auto_dispatch"))
                        }
                    process_order_batch(startup_order_batch)
                send_all_telemetry()
                if send_wind_shadow_by_default:
                    send_wind_shadow_zones()
                send_all_planned_paths()
                drain_world_events()
                is_running = True
                print(f"Bat dau simulation {sim_id} cho {frontend_id} voi {drone_count} drone")

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
                if send_wind_shadow_by_default:
                    send_wind_shadow_zones()
                send_all_planned_paths()
                send_all_telemetry()
                drain_world_events()
                last_path_ids = mark_current_paths()
                is_running = was_running

            elif msg_type == "request_wind_shadow":
                if not is_assigned or reject_wrong_sim(data):
                    continue
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
                    if send_wind_shadow_by_default:
                        send_wind_shadow_zones()
                    send_all_planned_paths()
                    drain_world_events()
                    last_path_ids = mark_current_paths()
                    is_running = True
                elif cmd == "stop":
                    print("Da nhan lenh STOP!")
                    is_running = False
                    world.stop()
                    send_all_telemetry(True)
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
                if world.is_all_done():
                    finished_status = world.final_status()
                    send_all_telemetry(True)
                    send_simulation_finished(finished_status)
                    send_worker_status("idle")
                    print("Simulation ket thuc. Worker ve idle.")
                    is_running = False
                    is_assigned = False
                    sim_id = None
                    frontend_id = None
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
