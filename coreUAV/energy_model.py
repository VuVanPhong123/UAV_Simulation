"""Shared demo energy model.

Angle convention: wind_to_deg is the direction the wind blows toward, using
the same degree system as the UAV heading from atan2(dy, dx).
"""

import math


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def angle_diff_deg(a, b):
    """
    Return signed smallest difference between two angles in degrees.
    """
    return (a - b + 180.0) % 360.0 - 180.0


def wind_factor(move_heading_deg, wind_to_deg, wind_speed, is_shielded=False):
    """
    Return multiplier for energy.
    > 1.0 means more expensive.
    < 1.0 means cheaper.

    wind_to_deg means the direction the wind blows toward.
    Tailwind should reduce or not increase energy.
    Headwind should increase energy.
    Crosswind should slightly increase energy.
    If shielded, reduce effective wind speed.
    """
    effective_wind_speed = max(0.0, wind_speed) * (0.2 if is_shielded else 1.0)
    diff = math.radians(angle_diff_deg(move_heading_deg, wind_to_deg))
    tailwind_component = math.cos(diff)
    crosswind_component = abs(math.sin(diff))

    factor = 1.0
    factor += max(0.0, -tailwind_component) * effective_wind_speed * 0.05
    factor -= max(0.0, tailwind_component) * effective_wind_speed * 0.015
    factor += crosswind_component * effective_wind_speed * 0.015
    return clamp(factor, 0.65, 2.5)


def temperature_factor(temp_c, optimal_temp=25.0, sensitivity=0.002):
    """
    Return multiplier >= 1.0.
    Temperature far from optimal increases energy.
    """
    factor = 1.0 + sensitivity * (temp_c - optimal_temp) ** 2
    return clamp(factor, 1.0, 2.5)


def rain_factor(is_raining=False):
    """
    Return simple environmental multipliers.
    """
    if is_raining:
        return {
            "speed_factor": 0.85,
            "energy_factor": 1.15,
            "sensor_factor": 0.8
        }
    return {
        "speed_factor": 1.0,
        "energy_factor": 1.0,
        "sensor_factor": 1.0
    }


def climb_energy_factor(climb_m):
    """
    Climbing costs more.
    Descending should not create negative energy.
    """
    if climb_m <= 0:
        return 1.0
    return 1.0 + min(climb_m * 0.03, 1.5)


def movement_energy(
    distance_m,
    speed,
    payload_weight=0.0,
    payload_penalty=0.0,
    wind_multiplier=1.0,
    temp_multiplier=1.0,
    rain_energy_multiplier=1.0,
    climb_m=0.0
):
    """
    Return normalized energy cost.
    Keep units simple and compatible with existing battery percent style.
    """
    payload_multiplier = 1.0 + max(0.0, payload_weight * payload_penalty)
    climb_multiplier = climb_energy_factor(climb_m)
    base = max(0.0, distance_m)
    return base * payload_multiplier * wind_multiplier * temp_multiplier * rain_energy_multiplier * climb_multiplier


def battery_drain_rate(
    base_rate,
    climb_rate,
    climbing=False,
    payload_weight=0.0,
    payload_penalty=0.0,
    move_heading_deg=0.0,
    wind_to_deg=0.0,
    wind_speed=0.0,
    is_shielded=False,
    temp_c=25.0,
    optimal_temp=25.0,
    temp_sensitivity=0.002,
    is_raining=False
):
    """
    Runtime drain rate per second, compatible with Drone.consume_battery().
    """
    rate = climb_rate if climbing else base_rate
    payload_multiplier = 1.0 + max(0.0, payload_weight * payload_penalty)
    wind_multiplier = wind_factor(move_heading_deg, wind_to_deg, wind_speed, is_shielded)
    temp_multiplier = temperature_factor(temp_c, optimal_temp, temp_sensitivity)
    rain_multiplier = rain_factor(is_raining)["energy_factor"]
    return rate * payload_multiplier * wind_multiplier * temp_multiplier * rain_multiplier
