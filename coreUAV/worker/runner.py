import copy
import json
import os
import time

import websocket
import yaml
from websocket import create_connection

from models.statuses import EventCode, EventLevel
from worker.state import WorkerState
from worker.sender import (
    SYSTEM_DRONE_ID,
    drain_order_mission_updates,
    drain_world_events,
    mark_current_paths,
    send_all_telemetry,
    send_event,
    send_planned_path_for_agent,
    send_simulation_finished,
    send_worker_status,
)
from worker.handlers import (
    clamp_int,
    parse_bool,
    handle_add_no_fly_zone,
    handle_add_obstacle,
    handle_command,
    handle_configure_drone,
    handle_dispatch_orders,
    handle_order_batch,
    handle_ping,
    handle_registered,
    handle_request_wind_shadow,
    handle_start_simulation,
    handle_weather_update,
)

WS_URL = os.getenv("BROKER_WS_URL", "ws://localhost:8080")
DEFAULT_TELEMETRY_EVERY_N_STEPS = 5
DEFAULT_MAP_ID = "hanoi_my_dinh_me_tri_large"
DEFAULT_DEMO_DRONES = 5
DEFAULT_MAX_DEMO_DRONES = 15
DEFAULT_WIND_SHADOW_MAX_POINTS = 400

WORKER_NAME = os.getenv("WORKER_NAME", f"local-worker-{os.getpid()}")
WORKER_MAX_DRONES = clamp_int(os.getenv("WORKER_MAX_DRONES"), 1, DEFAULT_MAX_DEMO_DRONES, DEFAULT_MAX_DEMO_DRONES)
WORKER_SUPPORTS_SHARDING = parse_bool(os.getenv("WORKER_SUPPORTS_SHARDING", "true"))

HANDLERS = {
    "registered": handle_registered,
    "ping": handle_ping,
    "start_simulation": handle_start_simulation,
    "configure_drone": handle_configure_drone,
    "add_obstacle": handle_add_obstacle,
    "add_no_fly_zone": handle_add_no_fly_zone,
    "weather_update": handle_weather_update,
    "request_wind_shadow": handle_request_wind_shadow,
    "order_batch": handle_order_batch,
    "dispatch_orders": handle_dispatch_orders,
    "command": handle_command,
}


def main():
    print("Dang ket noi toi Simulation Broker...")
    ws = create_connection(WS_URL)
    ws.settimeout(0.01)
    ws.send(json.dumps({
        "type": "register",
        "role": "worker",
        "workerName": WORKER_NAME,
        "metadata": {
            "workerName": WORKER_NAME,
            "capabilities": ["simulation", "order_dispatch", "large_map", "sharded_simulation"],
            "maxDrones": WORKER_MAX_DRONES,
            "supportsSharding": WORKER_SUPPORTS_SHARDING,
            "supportsCustomMap": False,
            "currentMapId": DEFAULT_MAP_ID,
            "pid": os.getpid(),
        },
    }))
    print("Da ket noi va gui register worker!")

    with open("config.yaml", "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)
    base_config = copy.deepcopy(config)
    performance_config = config.get("performance", {})
    max_demo_drones = clamp_int(
        performance_config.get("max_demo_drones"),
        1,
        DEFAULT_MAX_DEMO_DRONES,
        DEFAULT_MAX_DEMO_DRONES,
    )
    max_demo_drones = min(max_demo_drones, WORKER_MAX_DRONES)
    default_demo_drones = clamp_int(
        performance_config.get("default_demo_drones"),
        1,
        max_demo_drones,
        DEFAULT_DEMO_DRONES,
    )
    wind_shadow_max_points = clamp_int(
        performance_config.get("wind_shadow_max_points"),
        0,
        2000,
        DEFAULT_WIND_SHADOW_MAX_POINTS,
    )
    telemetry_every_n_steps = max(
        1,
        int(performance_config.get("telemetry_every_n_steps", DEFAULT_TELEMETRY_EVERY_N_STEPS)),
    )
    send_wind_shadow_by_default = bool(performance_config.get("send_wind_shadow_by_default", False))

    state = WorkerState(
        ws=ws,
        worker_name=WORKER_NAME,
        base_config=base_config,
        max_demo_drones=max_demo_drones,
        default_demo_drones=default_demo_drones,
        wind_shadow_max_points=wind_shadow_max_points,
        telemetry_every_n_steps=telemetry_every_n_steps,
        send_wind_shadow_by_default=send_wind_shadow_by_default,
        dt=config["simulation"]["time_step"],
    )

    print("\nWorker DA SAN SANG, dang cho start_simulation...\n")

    while True:
        try:
            msg = ws.recv()
            data = json.loads(msg)
            msg_type = data.get("type")
            handler = HANDLERS.get(msg_type)
            if handler:
                handler(state, data)
        except websocket.WebSocketTimeoutException:
            pass
        except Exception as e:
            print(f"[Worker Error] {e}")
            try:
                send_event(state, EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, str(e))
            except Exception:
                pass

        if state.is_running and state.world is not None:
            try:
                state.world.step()
                state.step += 1
                drain_world_events(state)
                drain_order_mission_updates(state)
                state.telemetry_counter += 1
                if state.telemetry_counter >= state.telemetry_every_n_steps:
                    send_all_telemetry(state)
                    state.telemetry_counter = 0

                current_path_ids = mark_current_paths(state)
                for agent in state.world.get_agents():
                    if current_path_ids.get(agent.drone_id) != state.last_path_ids.get(agent.drone_id):
                        print(f"   [Worker] Path changed for {agent.drone_id}, sending update...")
                        send_planned_path_for_agent(state, agent)
                        state.last_path_ids[agent.drone_id] = current_path_ids.get(agent.drone_id)

                time.sleep(state.dt)
            except Exception as e:
                print(f"[Worker Error] {e}")
                if state.world is not None:
                    state.world.stop()
                try:
                    send_all_telemetry(state, True)
                    send_event(state, EventLevel.ERROR.value, EventCode.WORKER_ERROR.value, str(e))
                    send_simulation_finished(state, "failed")
                    send_worker_status(state, "idle")
                except Exception:
                    pass
                state.is_running = False
                state.is_assigned = False
                state.sim_id = None
                state.frontend_id = None
        else:
            time.sleep(0.05)
