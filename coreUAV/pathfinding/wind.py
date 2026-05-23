import numpy as np

from physics.energy import rain_factor, temperature_factor, wind_factor


def check_wind_shadow(graph, node, wind_dir_deg, altitude, shadow_length=5):
    """Return True if node is shielded from wind by an upwind building."""
    reverse_wind_rad = np.radians((wind_dir_deg + 180) % 360)
    dx = np.cos(reverse_wind_rad)
    dy = np.sin(reverse_wind_rad)

    curr_x, curr_y = node
    for step in range(1, shadow_length + 1):
        check_x = int(curr_x + dx * step)
        check_y = int(curr_y + dy * step)
        if not (0 <= check_x < graph.cols and 0 <= check_y < graph.rows):
            break
        if graph.get_height((check_x, check_y)) >= altitude:
            return True
    return False


def get_energy_multiplier(
    graph,
    current,
    nxt,
    wind_dir_deg,
    wind_speed,
    altitude,
    ambient_temp=25.0,
    is_raining=False,
):
    """Combined wind + temperature + rain energy multiplier for a single move."""
    move_x = nxt[0] - current[0]
    move_y = nxt[1] - current[1]
    if move_x == 0 and move_y == 0:
        return 1.0

    move_heading_deg = np.degrees(np.arctan2(move_y, move_x))
    is_shielded = check_wind_shadow(graph, current, wind_dir_deg, altitude)
    wf = wind_factor(move_heading_deg, wind_dir_deg, wind_speed, is_shielded)
    tf = temperature_factor(ambient_temp)
    rf = rain_factor(is_raining)["energy_factor"]
    return wf * tf * rf


def get_wind_shadow_nodes(graph, wind_dir_deg, altitude, shadow_length=5):
    """Return UTM (x, y) coordinates of all nodes in wind shadow at given altitude."""
    shadow_nodes = []
    for i in range(graph.cols):
        for j in range(graph.rows):
            node = (i, j)
            if check_wind_shadow(graph, node, wind_dir_deg, altitude, shadow_length):
                x, y = graph.nodes[node]
                shadow_nodes.append((x, y))
    return shadow_nodes
