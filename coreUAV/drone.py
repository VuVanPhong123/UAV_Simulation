import numpy as np

class Drone:
    def __init__(self, config):
        self.max_battery = config['drone']['max_battery']
        self.battery = self.max_battery
        self.discharge_base = config['drone']['discharge_rate_base']
        self.discharge_climb = config['drone']['discharge_rate_climb']
        self.speed = config['drone']['speed']
        self.low_threshold = config['drone']['battery_low_threshold']
        self.safe_target = config['drone']['battery_safe_target']
        self.recharge_rate = config['drone']['recharge_rate']
        self.max_altitude = config['drone']['max_altitude']
        self.min_altitude = config['drone']['min_altitude']
        self.normal_altitude = config['drone']['normal_altitude']
        self.payload_weight = config['drone'].get('payload_weight', 0.0)
        self.payload_penalty = config['drone'].get('payload_penalty', 0.0)
        self.pos = None
        self.node = None
        self.altitude = self.normal_altitude
        self.heading = 0.0
        self.temperature = 30.0
        self.optimal_temp = 25.0
        self.temp_sensitivity = 0.002
        self.status = "flying"

    def consume_battery(self, dt, climbing=False, wind_speed=0.0, wind_dir=0.0, heading=0.0, is_shielded=False):
        rate = self.discharge_base
        if climbing:
            rate = self.discharge_climb
        rate += (self.payload_weight * self.payload_penalty)

        if wind_speed > 0:
            angle = np.radians(heading - wind_dir)
            headwind_component = wind_speed * np.cos(angle)
            crosswind_component = wind_speed * np.sin(angle)
            effective_wind_speed = wind_speed * 0.2 if is_shielded else wind_speed
            wind_penalty = 0.05 * abs(headwind_component) + 0.02 * abs(crosswind_component)
            rate *= (1 + wind_penalty)

        temp_penalty = 1.0 + self.temp_sensitivity * (self.temperature - self.optimal_temp)**2
        actual_rate = rate * temp_penalty

        self.battery -= actual_rate * dt
        if self.battery < 0:
            self.battery = 0

    def update_temperature(self, dt, ambient_temp=30.0):
        if self.status == "flying":
            target_temp = ambient_temp + 10.0
            self.temperature += (target_temp - self.temperature) * 0.05 * dt
        elif self.status == "charging":
            self.temperature += (ambient_temp - self.temperature) * 0.1 * dt
        self.temperature = max(-10, min(60, self.temperature))

    def recharge(self, dt):
        self.battery += self.recharge_rate * dt
        if self.battery >= self.safe_target:
            self.battery = self.safe_target
            self.status = "flying"
        else:
            self.status = "charging"