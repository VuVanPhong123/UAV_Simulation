from models.statuses import DroneStatus
from physics.energy import battery_drain_rate

class Drone:
    def __init__(self, config, overrides=None):
        base = config['drone']
        merged = {**base, **(overrides or {})}
        self.max_battery     = merged['max_battery']
        self.battery         = self.max_battery
        self.discharge_base  = merged['discharge_rate_base']
        self.discharge_climb = merged['discharge_rate_climb']
        self.speed           = merged['speed']
        self.low_threshold   = merged['battery_low_threshold']
        self.safe_target     = merged['battery_safe_target']
        self.recharge_rate   = merged['recharge_rate']
        self.max_altitude    = merged['max_altitude']
        self.min_altitude    = merged['min_altitude']
        self.normal_altitude = merged['normal_altitude']
        self.payload_weight  = merged.get('payload_weight', 0.0)
        self.payload_penalty = merged.get('payload_penalty', 0.0)
        self.pos = None
        self.node = None
        self.altitude = self.normal_altitude
        self.heading = 0.0
        self.temperature = 30.0
        self.optimal_temp = 25.0
        self.temp_sensitivity = 0.002
        self.status = DroneStatus.IDLE.value

    def consume_battery(self, dt, climbing=False, wind_speed=0.0, wind_dir=0.0, heading=0.0, is_shielded=False, is_raining=False):
        actual_rate = battery_drain_rate(
            self.discharge_base,
            self.discharge_climb,
            climbing=climbing,
            payload_weight=self.payload_weight,
            payload_penalty=self.payload_penalty,
            move_heading_deg=heading,
            wind_to_deg=wind_dir,
            wind_speed=wind_speed,
            is_shielded=is_shielded,
            temp_c=self.temperature,
            optimal_temp=self.optimal_temp,
            temp_sensitivity=self.temp_sensitivity,
            is_raining=is_raining
        )
        self.battery -= actual_rate * dt
        if self.battery < 0:
            self.battery = 0

    def update_temperature(self, dt, ambient_temp=30.0):
        if self.status == DroneStatus.FLYING.value:
            target_temp = ambient_temp + 10.0
            self.temperature += (target_temp - self.temperature) * 0.05 * dt
        elif self.status == DroneStatus.CHARGING.value:
            self.temperature += (ambient_temp - self.temperature) * 0.1 * dt
        self.temperature = max(-10, min(60, self.temperature))

    def recharge(self, dt):
        self.battery += self.recharge_rate * dt
        if self.battery >= self.safe_target:
            self.battery = self.safe_target
            self.status = DroneStatus.FLYING.value
        else:
            self.status = DroneStatus.CHARGING.value
