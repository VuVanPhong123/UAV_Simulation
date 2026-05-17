def path_point_node(point):
    if isinstance(point, dict):
        return point["node"]
    return point


def path_point_altitude(point, default_altitude):
    if isinstance(point, dict):
        return float(point.get("altitude", default_altitude))
    return float(default_altitude)
