import yaml
import time
import json
import numpy as np
import websocket
from pyproj import Transformer
from environment import DeliveryEnv

WS_URL = "ws://localhost:8080"

def on_open(ws):
    print("Đã kết nối tới Node.js Proxy")
    
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    env = DeliveryEnv(config)
    obs, _ = env.reset(seed=config['simulation']['seed'])
    
    crs_utm = env.graph.G.graph['crs']
    transformer = Transformer.from_crs(crs_utm, "epsg:4326", always_xy=True)
    
    step = 0
    dt = config['simulation']['time_step']
    
    while True:
        obs, reward, terminated, truncated, info = env.step()
        step += 1
        
        lon, lat = transformer.transform(obs['pos'][0], obs['pos'][1])
        
        state_data = {
            "step": step,
            "pos": [lat, lon], # Web cần [Lat, Lng]
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
    ws = websocket.WebSocketApp(WS_URL, on_open=on_open)
    ws.run_forever()