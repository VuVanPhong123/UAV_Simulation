import yaml
import time
import json
import numpy as np
import websocket
from environment import DeliveryEnv

WS_URL = "ws://localhost:8080"

def on_open(ws):
    print("Đã kết nối tới Node.js Proxy")
    
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    seed = config['simulation']['seed']
    np.random.seed(seed)
    
    env = DeliveryEnv(config)
    obs, _ = env.reset(seed=seed)
    
    step = 0
    dt = config['simulation']['time_step']
    
    while True:
        obs, reward, terminated, truncated, info = env.step()
        step += 1
        
        state_data = {
            "step": step,
            "pos": obs['pos'],
            "battery": float(obs['battery']),
            "altitude": float(obs['altitude']),
            "temperature": float(obs['temperature']),
            "status": obs['status'],
            "node": obs['node'],
            "terminated": terminated
        }
        
        ws.send(json.dumps(state_data))
        print(f"Sent step {step}: Pos {obs['pos']} | Bat {obs['battery']:.1f}%")
        
        time.sleep(dt) 
        
        if terminated or truncated:
            print("\nKết thúc vòng lặp mô phỏng.")
            break
            
    ws.close()

if __name__ == "__main__":
    ws = websocket.WebSocketApp(WS_URL, on_open=on_open)
    ws.run_forever()