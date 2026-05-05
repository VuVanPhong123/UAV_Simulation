import json
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT / "server"
CORE_DIR = ROOT / "coreUAV"
WS_URL = "ws://localhost:8080"
websocket = None


def pass_step(name):
    print(f"[PASS] {name}")


def fail_step(name, reason):
    print(f"[FAIL] {name}: {reason}")


def start_process(args, cwd):
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    return subprocess.Popen(
        args,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env
    )


def terminate_process(proc):
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def process_tail(proc):
    if proc is None or proc.stdout is None:
        return ""
    try:
        return proc.stdout.read()[-2000:]
    except Exception:
        return ""


def recv_until(ws, predicate, timeout_sec, step_name):
    deadline = time.time() + timeout_sec
    last_message = None
    while time.time() < deadline:
        try:
            raw = ws.recv()
            message = json.loads(raw)
            last_message = message
            if predicate(message):
                return message
        except websocket.WebSocketTimeoutException:
            continue
    raise TimeoutError(f"timeout waiting for {step_name}; last={last_message}")


def wait_process_alive(proc, timeout_sec, name):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"{name} exited early with code {proc.returncode}")
        time.sleep(0.2)


def main():
    global websocket
    try:
        import websocket as websocket_module
        websocket = websocket_module
    except ModuleNotFoundError as exc:
        fail_step("pipeline test", f"missing Python dependency: {exc.name}. Install coreUAV requirements first.")
        return 1

    server_proc = None
    worker_proc = None
    ws = None

    try:
        server_proc = start_process(["node", "index.js"], SERVER_DIR)
        wait_process_alive(server_proc, 2, "server")
        pass_step("server started")

        worker_proc = start_process([sys.executable, "worker.py"], CORE_DIR)
        wait_process_alive(worker_proc, 2, "worker")

        ws = websocket.create_connection(WS_URL, timeout=1)
        ws.send(json.dumps({
            "type": "register",
            "role": "frontend"
        }))

        recv_until(ws, lambda msg: msg.get("type") == "registered" and msg.get("role") == "frontend", 10, "frontend registered")
        pass_step("frontend registered")

        recv_until(
            ws,
            lambda msg: (
                msg.get("type") == "worker_status" and msg.get("status") == "idle"
            ) or (
                msg.get("type") == "connection_state" and msg.get("workerStatus") == "idle"
            ),
            30,
            "worker registered"
        )
        pass_step("worker registered")

        ws.send(json.dumps({
            "type": "request_start_simulation",
            "payload": {
                "mapId": "hanoi_default",
                "droneCount": 1
            }
        }))

        assigned = recv_until(ws, lambda msg: msg.get("type") == "simulation_assigned", 30, "simulation assigned")
        sim_id = assigned["simId"]
        pass_step("simulation assigned")

        recv_until(ws, lambda msg: msg.get("type") == "config" and msg.get("simId") == sim_id, 60, "config")
        telemetry_count = 0
        recv_until(
            ws,
            lambda msg: msg.get("type") == "telemetry" and msg.get("simId") == sim_id,
            60,
            "telemetry received"
        )
        telemetry_count += 1
        pass_step("telemetry received")

        recv_until(ws, lambda msg: msg.get("type") == "planned_path" and msg.get("simId") == sim_id, 60, "planned path received")
        pass_step("planned path received")

        ws.send(json.dumps({
            "type": "weather_update",
            "simId": sim_id,
            "wind_dir": 90,
            "wind_speed": 15,
            "ambient_temp": 35,
            "is_raining": True,
            "payload": {
                "wind_dir": 90,
                "wind_speed": 15,
                "ambient_temp": 35,
                "is_raining": True
            }
        }))

        recv_until(
            ws,
            lambda msg: (
                msg.get("type") == "event"
                and msg.get("payload", {}).get("code") in ("WEATHER_CHANGED", "PATH_REPLANNED")
            ) or (
                msg.get("type") == "telemetry"
                and msg.get("payload", {}).get("isRaining") is True
            ),
            60,
            "weather update accepted"
        )
        pass_step("weather update accepted")

        ws.send(json.dumps({
            "type": "add_obstacle",
            "simId": sim_id,
            "payload": {
                "pos": [21.0285, 105.8542],
                "radius": 8,
                "height": 25,
                "obstacleType": "unknown"
            }
        }))

        recv_until(
            ws,
            lambda msg: (
                msg.get("type") == "event"
                and msg.get("payload", {}).get("code") in ("OBSTACLE_ADDED", "OBSTACLE_DETECTED")
            ) or (
                msg.get("type") == "telemetry"
                and msg.get("simId") == sim_id
            ),
            60,
            "obstacle accepted"
        )
        pass_step("obstacle accepted")

        ws.send(json.dumps({
            "type": "command",
            "simId": sim_id,
            "action": "reset"
        }))

        recv_until(
            ws,
            lambda msg: msg.get("type") == "telemetry" and msg.get("simId") == sim_id,
            60,
            "reset accepted"
        )
        pass_step("reset accepted")
        pass_step("pipeline test completed")
        return 0

    except Exception as exc:
        fail_step("pipeline test", str(exc))
        if worker_proc and worker_proc.poll() is not None:
            print("worker output:")
            print(process_tail(worker_proc))
        if server_proc and server_proc.poll() is not None:
            print("server output:")
            print(process_tail(server_proc))
        return 1
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        terminate_process(worker_proc)
        terminate_process(server_proc)


if __name__ == "__main__":
    raise SystemExit(main())
