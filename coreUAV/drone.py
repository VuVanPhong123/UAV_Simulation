import math

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
        self.pos = None
        self.node = None
        self.altitude = self.normal_altitude
        self.heading = 0.0
        self.temperature = 30.0
        self.status = "flying"
        
    def update_temperature(self, dt):
        if self.status == "flying":
            self.temperature += 0.5 * dt
        elif self.status == "charging":
            self.temperature -= 1.0 * dt
        self.temperature = max(20, min(60, self.temperature))
    
    def consume_battery(self, dt, climbing=False):
        rate = self.discharge_base
        if climbing:
            rate = self.discharge_climb
        self.battery -= rate * dt
        if self.battery < 0:
            self.battery = 0
    
    def recharge(self, dt):
        self.battery += self.recharge_rate * dt
        if self.battery >= self.safe_target:
            self.battery = self.safe_target
            self.status = "flying"
        else:
            self.status = "charging"