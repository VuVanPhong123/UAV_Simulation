import yaml
import time
import json
from websocket import create_connection
from pyproj import Transformer
from environment import DeliveryEnv

WS_URL = "ws://localhost:8080"

def main():
    print("Đang kết nối tới Node.js Proxy...")
    ws = create_connection(WS_URL)
    print("Đã kết nối tới Node.js Proxy thành công!")
    
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
    print("-> Đã đẩy cấu hình bản đồ (Start, Goal, Stations) sang Frontend.")
    
    env = DeliveryEnv(config)
    obs, _ = env.reset(seed=config['simulation']['seed'])
    
    crs_utm = env.graph.crs_utm
    transformer = Transformer.from_crs(crs_utm, "epsg:4326", always_xy=True)
    
    step = 0
    dt = config['simulation']['time_step']
    
    while True:
        obs, reward, terminated, truncated, info = env.step()
        step += 1
        
        lon, lat = transformer.transform(obs['pos'][0], obs['pos'][1])
        
        state_data = {
            "type": "telemetry",
            "step": step,
            "pos": [lat, lon],
            "battery": float(obs['battery']),
            "altitude": float(obs['altitude']),
            "temperature": float(obs['temperature']),
            "status": obs['status'],
            "terminated": terminated
        }
        
        ws.send(json.dumps(state_data))
        print(f"Step {step}: GPS({lat:.5f}, {lon:.5f}) | Bat {obs['battery']:.1f}%")
        
        time.sleep(dt) 
        
        if terminated or truncated:
            print("\nKết thúc vòng lặp mô phỏng.")
            break
            
    ws.close()

if __name__ == "__main__":
    main()