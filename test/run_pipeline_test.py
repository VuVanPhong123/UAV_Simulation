import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT / "server"
CORE_DIR = ROOT / "coreUAV"
FAKE_CLIENT = ROOT / "test" / "fake_frontend_client.js"


def pass_step(name):
    print(f"[PASS] {name}")


def fail_step(name, reason):
    print(f"[FAIL] {name}: {reason}")


def tail_text(text, lines=50):
    if not text:
        return ""
    return "\n".join(text.splitlines()[-lines:])


def start_process(args, cwd, env=None):
    merged_env = os.environ.copy()
    merged_env["PYTHONUNBUFFERED"] = "1"
    if env:
        merged_env.update(env)
    return subprocess.Popen(
        args,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=merged_env
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


def wait_process_alive(proc, timeout_sec, name):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if proc.poll() is not None:
            output = proc.stdout.read() if proc.stdout else ""
            raise RuntimeError(f"{name} exited early with code {proc.returncode}\n{tail_text(output, 30)}")
        time.sleep(0.2)


def collect_output(proc):
    if proc is None or proc.stdout is None:
        return ""
    try:
        return proc.stdout.read()
    except Exception:
        return ""


def main():
    server_proc = None
    worker_proc = None
    fake_proc = None

    server_cwd = SERVER_DIR if (SERVER_DIR / "index.js").exists() else ROOT
    server_cmd = ["node", "index.js"]
    node_path = str(SERVER_DIR / "node_modules")

    try:
        server_proc = start_process(server_cmd, server_cwd)
        wait_process_alive(server_proc, 2, "server")
        pass_step("server started")

        worker_proc = start_process([sys.executable, "worker.py"], CORE_DIR)
        wait_process_alive(worker_proc, 2, "worker")
        pass_step("worker started")

        fake_proc = start_process(
            ["node", str(FAKE_CLIENT)],
            ROOT,
            env={"NODE_PATH": node_path}
        )
        fake_output, _ = fake_proc.communicate(timeout=90)
        print(fake_output, end="" if fake_output.endswith("\n") else "\n")

        if fake_proc.returncode != 0:
            fail_step("pipeline test", f"fake frontend exited with code {fake_proc.returncode}")
            print("fake frontend output tail:")
            print(tail_text(fake_output, 50))
            print("server output tail:")
            print(tail_text(collect_output(server_proc), 50))
            print("worker output tail:")
            print(tail_text(collect_output(worker_proc), 50))
            return 1

        return 0

    except subprocess.TimeoutExpired:
        if fake_proc:
            fake_proc.kill()
            fake_output, _ = fake_proc.communicate()
        else:
            fake_output = ""
        fail_step("pipeline test", "fake frontend timed out")
        print("fake frontend output tail:")
        print(tail_text(fake_output, 50))
        print("server output tail:")
        print(tail_text(collect_output(server_proc), 50))
        print("worker output tail:")
        print(tail_text(collect_output(worker_proc), 50))
        return 1
    except Exception as exc:
        fail_step("pipeline test", str(exc))
        print("server output tail:")
        print(tail_text(collect_output(server_proc), 50))
        print("worker output tail:")
        print(tail_text(collect_output(worker_proc), 50))
        return 1
    finally:
        terminate_process(fake_proc)
        terminate_process(worker_proc)
        terminate_process(server_proc)


if __name__ == "__main__":
    raise SystemExit(main())
