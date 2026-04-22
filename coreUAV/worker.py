import yaml
import time
import json
import websocket
from websocket import create_connection
from pyproj import Transformer
from environment import DeliveryEnv

WS_URL = "ws://localhost:8080"

def main():
    print("Dang ket noi toi Node.js Proxy...")
    ws = create_connection(WS_URL)
    ws.settimeout(0.01)
    print("Da ket noi toi Node.js Proxy thanh cong!")
    
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
        
    init_payload = {
        "type": "config",
        "start": config['map']['start_latlng'],
        "goal": config['map']['goal_latlng'],
        "charging_stations": config['map'].get('charging_stations_latlng', []),
        "no_fly_zones": config['map'].get('no_fly_zones', [])
    }
    ws.send(json.dumps(init_payload))
    print("-> Da day cau hinh ban do (Start, Goal, Stations) sang Frontend.")
    
    env = DeliveryEnv(config)
    obs, _ = env.reset(seed=config['simulation']['seed'])
    
    crs_utm = env.graph.crs_utm
    transformer = Transformer.from_crs(crs_utm, "epsg:4326", always_xy=True)
    
    dt = config['simulation']['time_step']
    is_running = False
    step = 0
    
    print("\n==============================================")
    print("Worker DA SAN SANG! Dang cho lenh tu Web...")
    print("==============================================\n")

    def send_telemetry():
        lon, lat = transformer.transform(env.drone.pos[0], env.drone.pos[1])
        state_data = {
            "type": "telemetry",
            "step": step,
            "pos": [lat, lon],
            "battery": float(env.drone.battery),
            "altitude": float(env.drone.altitude),
            "temperature": float(env.drone.temperature),
            "status": env.drone.status,
            "terminated": False
        }
        ws.send(json.dumps(state_data))

    send_telemetry()

    while True:
        try:
            msg = ws.recv()
            data = json.loads(msg)
            
            if data.get('type') == 'add_obstacle':
                env.add_obstacle(data['pos'])
                
            elif data.get('type') == 'command':
                cmd = data.get('action')
                if cmd == 'start':
                    if not is_running:
                        print("Da nhan lenh BAT DAU mo phong!")
                        is_running = True
                        
                elif cmd == 'reset':
                    print("Da nhan lenh LAM MOI (Reset) he thong!")
                    is_running = False
                    env.reset()
                    step = 0
                    send_telemetry()
                    
        except websocket.WebSocketTimeoutException:
            pass
        except Exception as e:
            pass 

        if is_running:
            obs, reward, terminated, truncated, info = env.step()
            step += 1
            
            send_telemetry()
            time.sleep(dt)
            
            if terminated or truncated:
                print("Hanh trinh ket thuc (Toi dich hoac Het pin). Chuyen ve trang thai IDLE.")
                is_running = False
        else:
            time.sleep(0.05)
            
    ws.close()

if __name__ == "__main__":
    main()