import gymnasium as gym
import numpy as np
from graph_map import WaypointGraph
from drone import Drone

class DeliveryEnv(gym.Env):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.graph = WaypointGraph(config)
        self.drone = Drone(config)
        self.time_step = config['simulation']['time_step']
        self.max_steps = config['simulation']['max_steps']
        self.step_count = 0
        self.path = []
        self.path_index = 0
        self.charging_mode = False
        self.avoiding = False
        self.avoid_timer = 0.0
        self.avoid_direction = 0
        self.obstacles = []
        self.sensor_range = config['obstacle_avoidance']['sensor_range']
        self.avoid_duration = config['obstacle_avoidance']['avoidance_duration']
        self.altitude_boost = config['obstacle_avoidance']['altitude_boost']
        self.turn_angle = config['obstacle_avoidance']['turn_angle']
        
        self.reset()
    
    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.drone.battery = self.drone.max_battery
        self.drone.status = "flying"
        self.drone.pos = self.graph.nodes[self.graph.start]
        self.drone.node = self.graph.start
        self.drone.altitude = self.drone.normal_altitude
        self.path = self.graph.a_star(self.graph.start, self.graph.goal)
        self.path_index = 0
        self.charging_mode = False
        self.step_count = 0
        self.avoiding = False
        self.avoid_timer = 0.0
        self.avoid_direction = 0
        print(f"Reset: start {self.graph.start} -> goal {self.graph.goal}")
        if not self.path:
            print("Không tìm thấy đường đi ban đầu!")
        return self._get_obs(), {}
    
    def _get_obs(self):
        return {
            "pos": self.drone.pos,
            "battery": self.drone.battery,
            "altitude": self.drone.altitude,
            "temperature": self.drone.temperature,
            "status": self.drone.status,
            "node": self.drone.node,
            "step": self.step_count
        }
    
    def _detect_obstacle(self):
        for obs in self.obstacles:
            dx = self.drone.pos[0] - obs[0]
            dy = self.drone.pos[1] - obs[1]
            dist = np.hypot(dx, dy)
            if dist < self.sensor_range:
                return True
        return False
    
    def _handle_avoidance(self, dt):
        if not self.avoiding:
            if self._detect_obstacle():
                self.avoiding = True
                self.avoid_timer = self.avoid_duration
                if self.drone.altitude < self.drone.max_altitude - 5:
                    self.drone.altitude = min(self.drone.max_altitude, self.drone.altitude + self.altitude_boost)
                    print(f"Né tránh: tăng độ cao lên {self.drone.altitude}m")
                else:
                    self.avoid_direction = 1 if np.random.rand() > 0.5 else -1
                    print(f" Né tránh: rẽ {'trái' if self.avoid_direction==-1 else 'phải'} {self.turn_angle}°")
        else:
            self.avoid_timer -= dt
            if self.avoid_timer <= 0:
                self.avoiding = False
                self.drone.altitude = self.drone.normal_altitude
                self.avoid_direction = 0
                print(" Kết thúc né tránh, quay lại đường bay bình thường")
        return self.avoiding
    
    def _is_out_of_bounds(self, pos):
        return False
    
    def step(self, action=None):
        dt = self.time_step
        self.step_count += 1
        terminated = False
        truncated = False
        
        avoiding = self._handle_avoidance(dt)
        
        if self.drone.status == "charging":
            self.drone.recharge(dt)
            self.drone.update_temperature(dt)
            if self.drone.status == "flying":
                print(f"Sạc xong, pin {self.drone.battery:.1f}%, tiếp tục bay đến goal")
                self.path = self.graph.a_star(self.drone.node, self.graph.goal)
                self.path_index = 0
                self.charging_mode = False
                if not self.path:
                    print("Không tìm được đường từ trạm đến goal!")
                    terminated = True
            return self._get_obs(), 0, terminated, truncated, {}
        
        if self.drone.battery < self.drone.low_threshold and not self.charging_mode:
            nearest = None
            best_dist = float('inf')
            for station in self.graph.charging_stations:
                path_to_station = self.graph.a_star(self.drone.node, station)
                if path_to_station:
                    dist = self.graph.heuristic(self.drone.node, station)
                    if dist < best_dist:
                        best_dist = dist
                        nearest = station
            if nearest is not None:
                self.charging_mode = True
                self.path = self.graph.a_star(self.drone.node, nearest)
                self.path_index = 0
                print(f"Pin yếu ({self.drone.battery:.1f}%), bay về trạm sạc {nearest}")
                if not self.path:
                    print("Không tìm được đường đến trạm sạc! Tiếp tục bay đến goal.")
                    self.charging_mode = False
            else:
                print(f"Pin yếu nhưng không có trạm sạc khả dụng! Tiếp tục bay.")
        
        # --- LOGIC DI CHUYỂN MỚI ---
        if self.path and self.path_index < len(self.path) - 1:
            next_node = self.path[self.path_index+1]
            x2, y2 = self.graph.nodes[next_node]
            
            # Tính vector từ vị trí HIỆN TẠI đến mục tiêu
            dx = x2 - self.drone.pos[0]
            dy = y2 - self.drone.pos[1]
            dist = np.hypot(dx, dy)
            
            if dist > 0:
                # Khóa khoảng cách, không cho phép move vượt quá dist còn lại
                move = min(self.drone.speed * dt, dist)
                ratio = move / dist
                new_x = self.drone.pos[0] + dx * ratio
                new_y = self.drone.pos[1] + dy * ratio
                self.drone.pos = (new_x, new_y)
                
                # Nếu khoảng cách còn lại <= bước đi trong 1 frame, tức là đã đến nơi
                if dist <= self.drone.speed * dt + 1e-4:
                    self.path_index += 1
                    self.drone.node = next_node
                    self.drone.pos = (x2, y2) # Snap chính xác vào node
        else:
            if self.drone.node != self.graph.goal:
                print("Hết path nhưng chưa đến goal!")
                terminated = True
        
        if self.drone.node == self.graph.goal and not self.charging_mode:
            terminated = True
            print("Giao hàng thành công!")
        
        if self.drone.status == "flying":
            climbing = (self.drone.altitude > self.drone.normal_altitude)
            self.drone.consume_battery(dt, climbing)
        
        if self.drone.battery <= 0:
            terminated = True
            print("Hết pin! Giao hàng thất bại.")
        
        self.drone.update_temperature(dt)
        
        if self.step_count >= self.max_steps:
            truncated = True
        
        return self._get_obs(), 0, terminated, truncated, {}