def priority_adjustment(priority: str) -> float:
    priority_value = (priority or "normal").strip().lower()
    if priority_value == "urgent":
        return -100.0
    if priority_value == "high":
        return -50.0
    if priority_value == "low":
        return 25.0
    return 0.0


def battery_risk_penalty(battery_percent: float, low_threshold: float, estimated_cost: float) -> float:
    if battery_percent < low_threshold:
        return float("inf")
    penalty = max(0.0, estimated_cost) * 0.02
    if battery_percent < 35.0:
        penalty += 100.0
    return penalty


def dispatch_score(
    cost_to_pickup,
    cost_delivery,
    payload_kg,
    priority,
    battery_percent,
    low_threshold,
) -> float:
    estimated_total = float(cost_to_pickup) + float(cost_delivery)
    return (
        estimated_total
        + (float(payload_kg) * 20.0)
        + priority_adjustment(priority)
        + battery_risk_penalty(float(battery_percent), float(low_threshold), estimated_total)
    )
