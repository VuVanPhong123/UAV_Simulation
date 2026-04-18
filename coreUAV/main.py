import yaml
import time
import numpy as np
from environment import DeliveryEnv

def print_state(obs, step, terminated, truncated):
    pos = obs['pos']
    battery = obs['battery']
    alt = obs['altitude']
    temp = obs['temperature']
    status = obs['status']
    node = obs['node']
    print(f"Step {step:4d} | Pos ({pos[0]:6.1f}, {pos[1]:6.1f}) | "
          f"Battery {battery:5.1f}% | Alt {alt:4.1f}m | Temp {temp:4.1f}C | "
          f"Status {status:8} | Node {node} | Terminated {terminated} | Truncated {truncated}")

def main():
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    seed = config['simulation']['seed']
    np.random.seed(seed)
    
    env = DeliveryEnv(config)
    obs, _ = env.reset(seed=seed)
    step = 0
    print_state(obs, step, False, False)
    
    while True:
        obs, reward, terminated, truncated, info = env.step()
        step += 1
        print_state(obs, step, terminated, truncated)
        if terminated or truncated:
            if terminated and obs['node'] == env.graph.goal:
                print("\nGiao hàng thành công!")
            elif terminated:
                print("\nGiao hàng thất bại (không đến được đích).")
            else:
                print("\nHết số bước cho phép (truncated).")
            break

if __name__ == "__main__":
    main()