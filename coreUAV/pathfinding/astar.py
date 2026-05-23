import heapq

import numpy as np

from pathfinding.utils import path_point_altitude, path_point_node
from pathfinding.wind import get_energy_multiplier


def a_star(
    graph,
    start,
    goal,
    current_altitude=20.0,
    wind_dir=0.0,
    wind_speed=0.0,
    ambient_temp=25.0,
    is_raining=False,
):
    """Flat (2D) weighted A* that respects dynamic obstacles and NFZ."""
    verbose = graph.performance_config.get("verbose_planner_logs", False)
    if verbose:
        print(f"   [A*] Planning from {start} to {goal} | wind {wind_speed}m/s to {wind_dir} deg")

    frontier = []
    heapq.heappush(frontier, (0, start))
    came_from = {start: None}
    cost_so_far = {start: 0}

    directions = [
        (0, 1, 1.0), (1, 0, 1.0), (0, -1, 1.0), (-1, 0, 1.0),
        (1, 1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (-1, -1, 1.4142),
    ]
    WEIGHT = 1.8

    while frontier:
        _, current = heapq.heappop(frontier)
        if current == goal:
            break

        for dx, dy, step_dist in directions:
            nxt = (current[0] + dx, current[1] + dy)
            if not (0 <= nxt[0] < graph.cols and 0 <= nxt[1] < graph.rows):
                continue
            if graph.is_in_dynamic_obs(nxt, current_altitude):
                continue
            if graph.is_in_dynamic_no_fly_zone(nxt, current_altitude):
                continue
            if graph.is_in_nfz(nxt):
                continue
            if graph.get_height(nxt) >= current_altitude and nxt != goal and nxt not in graph.charging_stations:
                continue

            energy_multiplier = get_energy_multiplier(
                graph, current, nxt, wind_dir, wind_speed, current_altitude, ambient_temp, is_raining
            )
            step_energy_cost = (step_dist * graph.resolution) * energy_multiplier
            new_cost = cost_so_far[current] + step_energy_cost

            if nxt not in cost_so_far or new_cost < cost_so_far[nxt]:
                cost_so_far[nxt] = new_cost
                priority = new_cost + WEIGHT * np.hypot(nxt[0] - goal[0], nxt[1] - goal[1]) * graph.resolution
                heapq.heappush(frontier, (priority, nxt))
                came_from[nxt] = current

    path = []
    node = goal
    while node is not None:
        path.append(node)
        node = came_from.get(node)

    if path and path[-1] == start:
        path.reverse()
        if verbose:
            print(f"   [A*] Found path with {len(path)} nodes.")
        return path

    if verbose:
        print("   [A*] Failed: no safe path found.")
    return []


def a_star_2_5d(
    graph,
    start,
    goal,
    current_altitude=20.0,
    wind_dir=0.0,
    wind_speed=0.0,
    ambient_temp=25.0,
    is_raining=False,
):
    """2.5D A* that explores horizontal moves and altitude transitions jointly."""
    verbose = graph.performance_config.get("verbose_planner_logs", False)
    if verbose:
        print(f"   [A* 2.5D] Planning from {start} to {goal} | wind {wind_speed}m/s to {wind_dir} deg")

    if start not in graph.nodes or goal not in graph.nodes:
        if verbose:
            print("   [A* 2.5D] Failed: start or goal is outside graph.")
        return []

    normal_altitude = float(graph.config.get("drone", {}).get("normal_altitude", current_altitude))
    start_idx = graph.get_altitude_index(current_altitude)

    if not graph.is_node_clear_at_altitude(start, graph.altitude_levels[start_idx]):
        clear_indices = [
            idx for idx, level in enumerate(graph.altitude_levels)
            if graph.is_node_clear_at_altitude(start, level)
        ]
        if not clear_indices:
            if verbose:
                print("   [A* 2.5D] Failed: start node is blocked at all altitude levels.")
            return []
        start_idx = min(clear_indices, key=lambda idx: abs(graph.altitude_levels[idx] - current_altitude))

    if not any(graph.is_node_clear_at_altitude(goal, level) for level in graph.altitude_levels):
        if verbose:
            print("   [A* 2.5D] Failed: goal node is blocked at all altitude levels.")
        return []

    start_state = (start[0], start[1], start_idx)
    frontier = []
    heapq.heappush(frontier, (0.0, start_state))
    came_from = {start_state: None}
    cost_so_far = {start_state: 0.0}

    directions = [
        (0, 1, 1.0), (1, 0, 1.0), (0, -1, 1.0), (-1, 0, 1.0),
        (1, 1, 1.4142), (-1, 1, 1.4142), (1, -1, 1.4142), (-1, -1, 1.4142),
    ]
    weight = 1.8
    goal_state = None

    while frontier:
        _, current_state = heapq.heappop(frontier)
        current_node = (current_state[0], current_state[1])
        altitude_idx = current_state[2]
        altitude = graph.altitude_levels[altitude_idx]

        if current_node == goal:
            goal_state = current_state
            break

        for dx, dy, step_dist in directions:
            nxt = (current_node[0] + dx, current_node[1] + dy)
            if not (0 <= nxt[0] < graph.cols and 0 <= nxt[1] < graph.rows):
                continue
            if not graph.is_node_clear_at_altitude(nxt, altitude):
                continue

            next_state = (nxt[0], nxt[1], altitude_idx)
            energy_multiplier = get_energy_multiplier(
                graph, current_node, nxt, wind_dir, wind_speed, altitude, ambient_temp, is_raining
            )
            movement_cost = (step_dist * graph.resolution) * energy_multiplier
            altitude_penalty = 0.01 * max(0.0, altitude - normal_altitude)
            new_cost = cost_so_far[current_state] + movement_cost + altitude_penalty

            if next_state not in cost_so_far or new_cost < cost_so_far[next_state]:
                cost_so_far[next_state] = new_cost
                altitude_bias = abs(altitude - normal_altitude) * 0.1
                priority = new_cost + weight * np.hypot(nxt[0] - goal[0], nxt[1] - goal[1]) * graph.resolution + altitude_bias
                heapq.heappush(frontier, (priority, next_state))
                came_from[next_state] = current_state

        for next_altitude_idx in (altitude_idx - 1, altitude_idx + 1):
            if not (0 <= next_altitude_idx < len(graph.altitude_levels)):
                continue
            next_altitude = graph.altitude_levels[next_altitude_idx]
            if not graph.is_node_clear_at_altitude(current_node, next_altitude):
                continue

            next_state = (current_node[0], current_node[1], next_altitude_idx)
            climb_m = abs(next_altitude - altitude)
            transition_cost = climb_m * (2.0 if next_altitude > altitude else 0.5)
            new_cost = cost_so_far[current_state] + transition_cost

            if next_state not in cost_so_far or new_cost < cost_so_far[next_state]:
                cost_so_far[next_state] = new_cost
                altitude_bias = abs(next_altitude - normal_altitude) * 0.1
                priority = new_cost + weight * np.hypot(current_node[0] - goal[0], current_node[1] - goal[1]) * graph.resolution + altitude_bias
                heapq.heappush(frontier, (priority, next_state))
                came_from[next_state] = current_state

    if goal_state is None:
        if verbose:
            print("   [A* 2.5D] Failed: no safe path found.")
        return []

    states = []
    state = goal_state
    while state is not None:
        states.append(state)
        state = came_from.get(state)
    states.reverse()

    path = [
        {"node": (s[0], s[1]), "altitude": float(graph.altitude_levels[s[2]])}
        for s in states
    ]
    if verbose:
        print(f"   [A* 2.5D] Found path with {len(path)} points.")
    return path


def is_line_of_sight(graph, node_a, node_b, altitude):
    """Bresenham line check: True if the straight line is clear at given altitude."""
    x0, y0 = int(node_a[0]), int(node_a[1])
    x1, y1 = int(node_b[0]), int(node_b[1])

    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy

    while True:
        if (x0, y0) != (int(node_a[0]), int(node_a[1])) and (x0, y0) != (int(node_b[0]), int(node_b[1])):
            if not graph.is_node_clear_at_altitude((x0, y0), altitude):
                return False
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy
    return True


def smooth_path(graph, raw_path, altitude):
    """Simplify a path by removing intermediate nodes when line-of-sight is clear."""
    if not raw_path:
        return []

    points = [
        {"node": path_point_node(p), "altitude": path_point_altitude(p, altitude)}
        for p in raw_path
    ]
    if len(points) <= 2:
        return points

    verbose = graph.performance_config.get("verbose_planner_logs", False)
    if verbose:
        print("   [Smooth] Simplifying flight path...")

    smoothed = [points[0]]
    curr = 0
    while curr < len(points) - 1:
        next_node = len(points) - 1
        while next_node > curr + 1:
            segment_altitude = min(
                path_point_altitude(points[curr], altitude),
                path_point_altitude(points[next_node], altitude),
            )
            if is_line_of_sight(
                graph,
                path_point_node(points[curr]),
                path_point_node(points[next_node]),
                segment_altitude,
            ):
                break
            next_node -= 1
        smoothed.append(points[next_node])
        curr = next_node

    if verbose:
        print(f"   [Smooth] Reduced from {len(raw_path)} to {len(smoothed)} nodes.")
    return smoothed


def estimate_path_cost(
    graph,
    path,
    altitude,
    wind_dir=0.0,
    wind_speed=0.0,
    ambient_temp=25.0,
    is_raining=False,
):
    """Estimate total energy cost of a path."""
    if not path:
        return float("inf")
    if len(path) < 2:
        return 0.0

    import numpy as np

    total = 0.0
    for current_point, next_point in zip(path, path[1:]):
        current = path_point_node(current_point)
        nxt = path_point_node(next_point)
        current_altitude = path_point_altitude(current_point, altitude)
        next_altitude = path_point_altitude(next_point, altitude)
        segment_altitude = min(current_altitude, next_altitude)
        dx = nxt[0] - current[0]
        dy = nxt[1] - current[1]
        step_dist = np.hypot(dx, dy)
        energy_multiplier = get_energy_multiplier(
            graph, current, nxt, wind_dir, wind_speed, segment_altitude, ambient_temp, is_raining
        )
        total += step_dist * graph.resolution * energy_multiplier
        if next_altitude > current_altitude:
            total += (next_altitude - current_altitude) * 2.0
        elif next_altitude < current_altitude:
            total += (current_altitude - next_altitude) * 0.5
    return total
