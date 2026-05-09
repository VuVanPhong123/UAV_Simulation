import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT / "server"
CORE_DIR = ROOT / "coreUAV"
FE_DIR = ROOT / "fe"


def worker_python_executable():
    windows_venv_python = CORE_DIR / "venv" / "Scripts" / "python.exe"
    unix_venv_python = CORE_DIR / "venv" / "bin" / "python"
    if windows_venv_python.exists():
        return str(windows_venv_python)
    if unix_venv_python.exists():
        return str(unix_venv_python)
    return sys.executable


def npm_command(*args):
    if os.name == "nt":
        return ["cmd", "/c", "npm", *args]
    return ["npm", *args]


def tail_text(text, lines=80):
    if not text:
        return ""
    return "\n".join(text.splitlines()[-lines:])


def start_process(args, cwd, env=None):
    merged_env = os.environ.copy()
    merged_env["PYTHONUNBUFFERED"] = "1"
    merged_env["PYTHONIOENCODING"] = "utf-8"
    if env:
        merged_env.update(env)

    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["preexec_fn"] = os.setsid

    return subprocess.Popen(
        args,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=merged_env,
        **kwargs,
    )


def terminate_process(proc):
    if proc is None or proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            pass


def collect_output(proc):
    if proc is None or proc.stdout is None:
        return ""
    try:
        if proc.poll() is None:
            return ""
        return proc.stdout.read()
    except Exception:
        return ""


def wait_process_alive(proc, timeout_sec, name):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if proc.poll() is not None:
            output = collect_output(proc)
            raise RuntimeError(f"{name} exited early with code {proc.returncode}\n{tail_text(output, 60)}")
        time.sleep(0.2)


def wait_http_ready(url, proc, timeout_sec, name):
    deadline = time.time() + timeout_sec
    last_error = None
    while time.time() < deadline:
        if proc.poll() is not None:
            output = collect_output(proc)
            raise RuntimeError(f"{name} exited before {url} was ready with code {proc.returncode}\n{tail_text(output, 60)}")
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status < 500:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = exc
        time.sleep(1)
    output = collect_output(proc)
    raise RuntimeError(f"{name} did not become ready at {url}: {last_error}\n{tail_text(output, 60)}")


def print_process_tail(name, proc):
    output = collect_output(proc)
    if output:
        print(f"{name} output tail:")
        print(tail_text(output, 80))


def main():
    server_proc = None
    worker_proc = None
    fe_proc = None
    playwright_proc = None

    server_cwd = SERVER_DIR if (SERVER_DIR / "index.js").exists() else ROOT
    server_cmd = ["node", "index.js"]

    try:
        server_proc = start_process(server_cmd, server_cwd)
        wait_process_alive(server_proc, 2, "server broker")
        print("[PASS] server broker started")

        worker_proc = start_process([worker_python_executable(), "worker.py"], CORE_DIR)
        wait_process_alive(worker_proc, 2, "coreUAV worker")
        print("[PASS] coreUAV worker started")

        fe_proc = start_process(npm_command("run", "dev"), FE_DIR, env={"PORT": "3000"})
        wait_http_ready("http://localhost:3000", fe_proc, 120, "FE dev server")
        print("[PASS] FE dev server ready")

        playwright_proc = start_process(npm_command("run", "test:e2e"), FE_DIR)
        output, _ = playwright_proc.communicate(timeout=240)
        print(output, end="" if output.endswith("\n") else "\n")

        if playwright_proc.returncode != 0:
            print(f"[FAIL] browser e2e exited with code {playwright_proc.returncode}")
            print("Playwright output tail:")
            print(tail_text(output, 100))
            if "Executable doesn't exist" in output or "playwright install" in output:
                print("Chromium browser may be missing. Run: cd fe && npm run test:e2e:install")
            return playwright_proc.returncode

        print("[PASS] browser e2e completed")
        return 0

    except subprocess.TimeoutExpired:
        if playwright_proc:
            playwright_proc.kill()
            output, _ = playwright_proc.communicate()
        else:
            output = ""
        print("[FAIL] browser e2e timed out")
        print("Playwright output tail:")
        print(tail_text(output, 100))
        return 1
    except Exception as exc:
        print(f"[FAIL] browser e2e orchestration: {exc}")
        return 1
    finally:
        terminate_process(playwright_proc)
        terminate_process(fe_proc)
        terminate_process(worker_proc)
        terminate_process(server_proc)
        print_process_tail("FE", fe_proc)
        print_process_tail("worker", worker_proc)
        print_process_tail("server", server_proc)


if __name__ == "__main__":
    raise SystemExit(main())
