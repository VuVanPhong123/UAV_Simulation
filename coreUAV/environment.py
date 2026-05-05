import gymnasium as gym
import numpy as np
from graph_map import WaypointGraph
from drone import Drone
from statuses import DroneStatus, EventCode, EventLevel


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
        self.pending_events = []
        self.current_target_node = self.graph.goal
        self.current_target_type = "goal"
        self.sensor_range = config['obstacle_avoidance']['sensor_range']
        self.avoid_duration = config['obstacle_avoidance']['avoidance_duration']
        self.altitude_boost = config['obstacle_avoidance']['altitude_boost']
        self.turn_angle = config['obstacle_avoidance']['turn_angle']
        self.wind_dir = 0.0
        self.wind_speed = 0.0
        self.ambient_temp = 25.0

    def queue_event(self, level, code, message):
        self.pending_events.append({
            "level": level,
            "code": code,
            "message": message
        })

    def drain_events(self):
        events = self.pending_events
        self.pending_events = []
        return events

    def update_weather(self, wind_dir, wind_speed, ambient_temp):
        self.wind_dir = wind_dir
        self.wind_speed = wind_speed
        self.ambient_temp = ambient_temp
        print(f"   [Env] Cap nhat thoi tiet: Gio {wind_speed}m/s, Huong {wind_dir} deg, Temp {ambient_temp}C")

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)

        self.obstacles = []
        self.pending_events = []
        self.graph.clear_dynamic_obstacles()

        self.drone.battery = self.drone.max_battery
        self.drone.status = DroneStatus.PLANNING.value
        self.drone.pos = self.graph.nodes[self.graph.start]
        self.drone.node = self.graph.start
        self.drone.altitude = self.drone.normal_altitude
        self.drone.heading = 0.0
        self.drone.temperature = 30.0

        self.current_target_node = self.graph.goal
        self.current_target_type = "goal"
        self.charging_mode = False
        self.avoiding = False
        self.avoid_timer = 0.0
        self.avoid_direction = 0
        self.path_index = 0
        self.step_count = 0

        print("Dang tinh toan quy dao goc...")
        raw_path = self.graph.a_star(
            self.graph.start,
            self.current_target_node,
            current_altitude=self.drone.altitude,
            wind_dir=self.wind_dir,
            wind_speed=self.wind_speed
        )
        self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
        if self.path:
            self.drone.status = DroneStatus.FLYING.value
        else:
            self.drone.status = DroneStatus.FAILED.value
            self.queue_event(EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "No initial path to goal.")

        return self._get_obs(), {}

    def add_obstacle(self, latlng, radius=8.0, height=25.0, obstacle_type="unknown"):
        x, y = self.graph.transformer.transform(latlng[1], latlng[0])
        self.obstacles.append({
            'pos': (x, y),
            'radius': float(radius),
            'height': float(height),
            'type': obstacle_type,
            'detected': False
        })
        print(f"Ve tinh bao cao vat can {obstacle_type} tai GPS {latlng}, r={radius}m, h={height}m")

    def _get_obs(self):
        return {
            "pos": self.drone.pos,
            "battery": self.drone.battery,
            "batteryPercent": self.drone.battery,
            "altitude": self.drone.altitude,
            "speed": self.drone.speed,
            "heading": self.drone.heading,
            "temperature": self.drone.temperature,
            "status": self.drone.status,
            "mode": "delivery",
            "energyConsumed": self.drone.max_battery - self.drone.battery,
            "node": self.drone.node,
            "step": self.step_count
        }

    def _current_grid_node(self):
        cx = int(round((self.drone.pos[0] - self.graph.min_x) / self.graph.resolution))
        cy = int(round((self.drone.pos[1] - self.graph.min_y) / self.graph.resolution))
        cx = max(0, min(self.graph.cols - 1, cx))
        cy = max(0, min(self.graph.rows - 1, cy))
        return (cx, cy)

    def _find_best_charging_station(self):
        best_station = None
        best_path = None
        best_cost = float("inf")

        for station_node in self.graph.charging_stations:
            path = self.graph.a_star(
                self.drone.node,
                station_node,
                current_altitude=self.drone.altitude,
                wind_dir=self.wind_dir,
                wind_speed=self.wind_speed
            )
            if not path:
                continue

            cost = self.graph.estimate_path_cost(
                path,
                self.drone.altitude,
                self.wind_dir,
                self.wind_speed
            )
            if cost < best_cost:
                best_cost = cost
                best_station = station_node
                best_path = path

        return best_station, best_path, best_cost

    def _detect_obstacle(self):
        blocking_detected = False
        for obs in self.obstacles:
            if obs['detected']:
                continue

            dx = self.drone.pos[0] - obs['pos'][0]
            dy = self.drone.pos[1] - obs['pos'][1]
            if np.hypot(dx, dy) > self.sensor_range + obs['radius']:
                continue

            obs['detected'] = True
            self.graph.add_dynamic_obstacle(obs['pos'], obs['radius'], obs['height'])
            self.queue_event(
                EventLevel.WARNING.value,
                EventCode.OBSTACLE_DETECTED.value,
                f"Obstacle detected: {obs['type']} r={obs['radius']:.1f}m h={obs['height']:.1f}m."
            )

            if self.drone.altitude > obs['height'] + self.graph.safety_margin:
                self.queue_event(
                    EventLevel.INFO.value,
                    EventCode.OBSTACLE_DETECTED.value,
                    "Obstacle is below current safe altitude; continuing over it."
                )
                continue

            blocking_detected = True

        return blocking_detected

    def _handle_avoidance(self, dt):
        if self.drone.status in (DroneStatus.CHARGING.value, DroneStatus.SUCCESS.value, DroneStatus.FAILED.value, DroneStatus.EMERGENCY_LANDING.value):
            return False

        if not self.avoiding:
            if self._detect_obstacle():
                print("Canh bao: phat hien vat can chan duong, tinh lai quy dao...")
                self.avoiding = True
                self.avoid_timer = self.avoid_duration
                self.drone.status = DroneStatus.REROUTING.value

                self.drone.node = self._current_grid_node()
                raw_path = self.graph.a_star(
                    self.drone.node,
                    self.current_target_node,
                    current_altitude=self.drone.altitude,
                    wind_dir=self.wind_dir,
                    wind_speed=self.wind_speed
                )

                if raw_path:
                    self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
                    self.path_index = 0
                    self.drone.status = DroneStatus.FLYING.value
                    self.queue_event(EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned around obstacle.")
                else:
                    print("Het duong lach, thu tang do cao pop-up...")
                    self.drone.altitude = min(self.drone.max_altitude, self.drone.altitude + self.altitude_boost)
                    raw_path = self.graph.a_star(
                        self.drone.node,
                        self.current_target_node,
                        current_altitude=self.drone.altitude,
                        wind_dir=self.wind_dir,
                        wind_speed=self.wind_speed
                    )
                    if raw_path:
                        self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
                        self.path_index = 0
                        self.drone.status = DroneStatus.FLYING.value
                        self.queue_event(EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned after altitude pop-up.")
                    else:
                        self.drone.status = DroneStatus.EMERGENCY_LANDING.value
                        self.queue_event(EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "No safe path after obstacle detection.")
        else:
            self.avoid_timer -= dt
            if self.avoid_timer <= 0:
                self.avoiding = False
                if self.drone.altitude > self.drone.normal_altitude:
                    self.drone.altitude = self.drone.normal_altitude
                self.avoid_direction = 0
                print("Ket thuc ne tranh, quay lai bay binh thuong")

        return self.avoiding

    def _is_out_of_bounds(self, pos):
        return False

    def step(self, action=None):
        dt = self.time_step
        self.step_count += 1
        terminated = False
        truncated = False

        if self.drone.status in (DroneStatus.EMERGENCY_LANDING.value, DroneStatus.FAILED.value):
            return self._get_obs(), 0, True, truncated, {}

        if self.drone.status == DroneStatus.CHARGING.value:
            self.drone.recharge(dt)
            self.drone.update_temperature(dt, self.ambient_temp)
            if self.drone.status == DroneStatus.FLYING.value:
                self.queue_event(EventLevel.SUCCESS.value, EventCode.CHARGING_COMPLETED.value, "Charging completed.")
                self.current_target_node = self.graph.goal
                self.current_target_type = "goal"
                self.drone.status = DroneStatus.PLANNING.value
                raw_path = self.graph.a_star(
                    self.drone.node,
                    self.current_target_node,
                    current_altitude=self.drone.altitude,
                    wind_dir=self.wind_dir,
                    wind_speed=self.wind_speed
                )
                self.path = self.graph.smooth_path(raw_path, self.drone.altitude)
                self.path_index = 0
                self.charging_mode = False
                if self.path:
                    self.drone.status = DroneStatus.FLYING.value
                    self.queue_event(EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, "Path replanned from charging station to goal.")
                else:
                    self.drone.status = DroneStatus.EMERGENCY_LANDING.value
                    self.queue_event(EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "No path from charging station to goal.")
                    terminated = True
            return self._get_obs(), 0, terminated, truncated, {}

        self._handle_avoidance(dt)
        if self.drone.status == DroneStatus.EMERGENCY_LANDING.value:
            return self._get_obs(), 0, True, truncated, {}

        if (
            self.drone.status == DroneStatus.FLYING.value
            and self.drone.battery < self.drone.low_threshold
            and not self.charging_mode
        ):
            station_node, station_path, station_cost = self._find_best_charging_station()
            if station_node and station_path:
                self.charging_mode = True
                self.current_target_node = station_node
                self.current_target_type = "charging_station"
                self.drone.status = DroneStatus.PLANNING.value
                self.path = self.graph.smooth_path(station_path, self.drone.altitude)
                self.path_index = 0
                self.drone.status = DroneStatus.FLYING.value if self.path else DroneStatus.EMERGENCY_LANDING.value
                self.queue_event(EventLevel.INFO.value, EventCode.PATH_REPLANNED.value, f"Low battery: rerouting to charging station, cost={station_cost:.1f}.")
            else:
                self.drone.status = DroneStatus.EMERGENCY_LANDING.value
                self.queue_event(EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Low battery and no reachable charging station.")
                return self._get_obs(), 0, True, truncated, {}

        if self.path and self.path_index < len(self.path) - 1:
            next_node = self.path[self.path_index + 1]
            x2, y2 = self.graph.nodes[next_node]

            dx = x2 - self.drone.pos[0]
            dy = y2 - self.drone.pos[1]
            dist = np.hypot(dx, dy)

            if dist > 0:
                self.drone.heading = np.degrees(np.arctan2(dy, dx))
                move = min(self.drone.speed * dt, dist)
                ratio = move / dist
                self.drone.pos = (
                    self.drone.pos[0] + dx * ratio,
                    self.drone.pos[1] + dy * ratio
                )

                if dist <= self.drone.speed * dt + 1e-4:
                    self.path_index += 1
                    self.drone.node = next_node
                    self.drone.pos = (x2, y2)

        if self.drone.node == self.current_target_node:
            if self.current_target_type == "charging_station":
                if self.drone.status != DroneStatus.CHARGING.value:
                    self.path = []
                    self.path_index = 0
                    self.charging_mode = True
                    self.drone.status = DroneStatus.CHARGING.value
                    self.queue_event(EventLevel.INFO.value, EventCode.CHARGING_STARTED.value, "Charging started.")
            elif self.current_target_type == "goal":
                terminated = True
                self.drone.status = DroneStatus.SUCCESS.value
                self.queue_event(EventLevel.SUCCESS.value, EventCode.DELIVERY_SUCCESS.value, "Delivery completed successfully.")
        elif not self.path or self.path_index >= len(self.path) - 1:
            self.drone.status = DroneStatus.FAILED.value
            self.queue_event(EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Path ended before reaching target.")
            terminated = True

        if self.drone.status == DroneStatus.FLYING.value:
            climbing = self.drone.altitude > self.drone.normal_altitude
            is_shielded = self.graph.check_wind_shadow(
                self.drone.node, self.wind_dir, self.drone.altitude
            )
            self.drone.consume_battery(
                dt,
                climbing,
                wind_speed=self.wind_speed,
                wind_dir=self.wind_dir,
                heading=self.drone.heading,
                is_shielded=is_shielded
            )

        if self.drone.battery <= 0:
            terminated = True
            self.drone.status = DroneStatus.EMERGENCY_LANDING.value
            self.queue_event(EventLevel.ERROR.value, EventCode.EMERGENCY_LANDING.value, "Battery depleted. Emergency landing.")

        self.drone.update_temperature(dt, self.ambient_temp)

        if self.step_count >= self.max_steps:
            truncated = True
            if self.drone.status != DroneStatus.SUCCESS.value:
                self.drone.status = DroneStatus.FAILED.value
                self.queue_event(EventLevel.ERROR.value, EventCode.DELIVERY_FAILED.value, "Simulation reached max steps.")

        return self._get_obs(), 0, terminated, truncated, {}
