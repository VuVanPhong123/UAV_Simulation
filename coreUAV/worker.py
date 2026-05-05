import yaml
import time
import json
import websocket
from websocket import create_connection
from pyproj import Transformer
from environment import DeliveryEnv
from statuses import DroneStatus, EventCode, EventLevel

WS_URL = "ws://localhost:8080"
SIM_ID = "sim_001"
DRONE_ID = "drone_1"


def now_ms():
    return int(time.time() * 1000)


def main():
    print("Dang ket noi toi Node.js Proxy...")
    ws = create_connection(WS_URL)
    ws.settimeout(0.01)
    print("Da ket noi thanh cong!")

    def send_event(level, code, message):
        ws.send(json.dumps({
            "type": "event",
            "simId": SIM_ID,
            "droneId": DRONE_ID,
            "timestamp": now_ms(),
            "payload": {
                "level": level,
                "code": code,
                "message": message
            }
        }))

    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)

    init_payload = {
        "type": "config",
        "simId": SIM_ID,
        "droneId": DRONE_ID,
        "timestamp": now_ms(),
        "start": config['map']['start_latlng'],
        "goal": config['map']['goal_latlng'],
        "charging_stations": config['map'].get('charging_stations_latlng', []),
        "no_fly_zones": config['map'].get('no_fly_zones', [])
    }
    ws.send(json.dumps(init_payload))
    send_event(EventLevel.INFO.value, EventCode.PATH_PLANNED.value, "Map config sent.")
    print("-> Da gui cau hinh ban do.")

    env = DeliveryEnv(config)
    obs, _ = env.reset(seed=config['simulation']['seed'])

    crs_utm = env.graph.crs_utm
    transformer = Transformer.from_crs(crs_utm, "epsg:4326", always_xy=True)

    dt = config['simulation']['time_step']
    is_running = False
    step = 0
    telemetry_counter = 0
    TELEMETRY_EVERY_N_STEPS = 2

    print("\nWorker DA SAN SANG!\n")

    def send_telemetry(terminated=False):
        lon, lat = transformer.transform(env.drone.pos[0], env.drone.pos[1])
        payload = {
            "pos": [lat, lon],
            "batteryPercent": float(env.drone.battery),
            "altitude": float(env.drone.altitude),
            "speed": float(env.drone.speed),
            "heading": float(env.drone.heading),
            "temperature": float(env.drone.temperature),
            "status": env.drone.status,
            "mode": "delivery",
            "energyConsumed": float(env.drone.max_battery - env.drone.battery),
            "step": step,
            "terminated": terminated
        }
        ws.send(json.dumps({
            "type": "telemetry",
            "simId": SIM_ID,
            "droneId": DRONE_ID,
            "timestamp": now_ms(),
            "payload": payload,
            "step": payload["step"],
            "pos": payload["pos"],
            "battery": payload["batteryPercent"],
            "batteryPercent": payload["batteryPercent"],
            "altitude": payload["altitude"],
            "speed": payload["speed"],
            "heading": payload["heading"],
            "temperature": payload["temperature"],
            "status": payload["status"],
            "terminated": payload["terminated"]
        }))

    def send_wind_shadow_zones():
        shadow_utm = env.graph.get_wind_shadow_nodes(env.wind_dir, env.drone.normal_altitude)
        shadow_gps = []
        for (x, y) in shadow_utm:
            lon, lat = transformer.transform(x, y)
            shadow_gps.append([lat, lon])
        ws.send(json.dumps({
            "type": "wind_shadow_zones",
            "simId": SIM_ID,
            "timestamp": now_ms(),
            "payload": {
                "zones": shadow_gps
            },
            "zones": shadow_gps
        }))

    def send_planned_path():
        if not env.path:
            return
        gps_path = []

        if env.drone.pos:
            lon_d, lat_d = transformer.transform(env.drone.pos[0], env.drone.pos[1])
            gps_path.append([lat_d, lon_d])

        for node in env.path[env.path_index:]:
            x, y = env.graph.nodes[node]
            lon, lat = transformer.transform(x, y)
            gps_path.append([lat, lon])

        ws.send(json.dumps({
            "type": "planned_path",
            "simId": SIM_ID,
            "droneId": DRONE_ID,
            "timestamp": now_ms(),
            "payload": {
                "path": gps_path
            },
            "path": gps_path
        }))

    send_telemetry()
    send_wind_shadow_zones()
    send_planned_path()
    send_event(EventLevel.INFO.value, EventCode.PATH_PLANNED.value, "Initial path planned.")

    last_path_id = id(env.path)

    while True:
        try:
            msg = ws.recv()
            data = json.loads(msg)

            if data.get('type') == 'add_obstacle':
                env.add_obstacle(data['pos'])
                send_event(EventLevel.WARNING.value, EventCode.OBSTACLE_ADDED.value, "Obstacle added by user.")

            elif data.get('type') == 'weather_update':
                was_running = is_running
                is_running = False
                send_event(EventLevel.INFO.value, EventCode.WEATHER_CHANGED.value, "Weather changed. Replanning path.")
                env.update_weather(
                    wind_dir=float(data['wind_dir']),
                    wind_speed=float(data['wind_speed']),
                    ambient_temp=float(data['ambient_temp'])
                )
                print("   [Worker] Tinh lai duong theo gio moi...")

                current_x, current_y = env.drone.pos
                cx = int(round((current_x - env.graph.min_x) / env.graph.resolution))
                cy = int(round((current_y - env.graph.min_y) / env.graph.resolution))

                cx = max(0, min(env.graph.cols - 1, cx))
                cy = max(0, min(env.graph.rows - 1, cy))

                env.drone.node = (cx, cy)
                env.drone.status = DroneStatus.PLANNING.value

                raw_path = env.graph.a_star(
                    env.drone.node,
                    env.graph.goal,
                    current_altitude=env.drone.altitude,
                    wind_dir=env.wind_dir,
                    wind_speed=env.wind_speed
                )
                env.path = env.graph.smooth_path(raw_path, env.drone.altitude)
                env.path_index = 0
                env.drone.status = DroneStatus.FLYING.value if env.path else DroneStatus.FAILED.value
                send_wind_shadow_zones()
                send_planned_path()
                if env.path:
                    send_event(EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned after weather update.")
                else:
                    send_event(EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Delivery failed.")
                is_running = was_running
                last_path_id = id(env.path)

            elif data.get('type') == 'command':
                cmd = data.get('action')
                if cmd == 'start' and not is_running:
                    print("Da nhan lenh BAT DAU!")
                    is_running = True
                    send_event(EventLevel.INFO.value, EventCode.PATH_PLANNED.value, "Simulation started.")
                elif cmd == 'reset':
                    print("Da nhan lenh RESET!")
                    is_running = False
                    env.reset()
                    step = 0
                    send_telemetry()
                    send_wind_shadow_zones()
                    send_planned_path()
                    send_event(EventLevel.INFO.value, EventCode.PATH_PLANNED.value, "Simulation reset and path planned.")
                    last_path_id = id(env.path)

        except websocket.WebSocketTimeoutException:
            pass
        except Exception as e:
            print(f"[Worker Error] {e}")
            try:
                send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, str(e))
            except Exception:
                pass

        if is_running:
            try:
                obs, reward, terminated, truncated, info = env.step()
                step += 1
                telemetry_counter += 1
                if telemetry_counter >= TELEMETRY_EVERY_N_STEPS:
                    send_telemetry(terminated or truncated)
                    telemetry_counter = 0

                current_path_id = id(env.path)
                if current_path_id != last_path_id:
                    print("   [Worker] Phat hien quy dao thay doi, dang gui update len UI...")
                    send_planned_path()
                    send_event(EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned.")
                    last_path_id = current_path_id

                time.sleep(dt)
                if terminated or truncated:
                    if env.drone.status == DroneStatus.SUCCESS.value:
                        send_telemetry(True)
                        send_event(EventLevel.SUCCESS.value, EventCode.DELIVERY_SUCCESS.value, "Delivery completed successfully.")
                    else:
                        env.drone.status = DroneStatus.FAILED.value
                        send_telemetry(True)
                        send_event(EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Delivery failed.")
                    print("Chuyen dong ket thuc. Chuyen sang IDLE.")
                    is_running = False
            except Exception as e:
                print(f"[Worker Error] {e}")
                env.drone.status = DroneStatus.FAILED.value
                is_running = False
                try:
                    send_telemetry(True)
                    send_event(EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, str(e))
                except Exception:
                    pass
        else:
            time.sleep(0.05)

    ws.close()


if __name__ == "__main__":
    main()
