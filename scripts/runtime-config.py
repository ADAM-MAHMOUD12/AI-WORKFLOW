import argparse
import json
import socket
from pathlib import Path


PORT_RANGES = {
    "api": (8000, 8099),
    "engine2d": (5174, 5273),
    "engine3d": (3002, 3101),
    "theia": (3102, 3201),
    "frontend": (5173, 5272),
}


def is_available(port: int) -> bool:
    addresses = {"127.0.0.1", "0.0.0.0", local_ip()}
    for address in addresses:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            try:
                server.bind((address, port))
            except OSError:
                return False
    return True


def choose_ports() -> dict[str, int]:
    selected: dict[str, int] = {}
    for service, (first, last) in PORT_RANGES.items():
        port = next((candidate for candidate in range(first, last + 1)
                     if candidate not in selected.values() and is_available(candidate)), None)
        if port is None:
            raise RuntimeError(f"No available {service} port in the configured range.")
        selected[service] = port
    return selected


def local_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
        try:
            route.connect(("192.0.2.1", 1))
            address = route.getsockname()[0]
            if address and not address.startswith("127.") and not address.startswith("169.254."):
                return address
        except OSError:
            pass
    return "127.0.0.1"


parser = argparse.ArgumentParser()
parser.add_argument("command", choices=("discover", "write"))
parser.add_argument("ports", nargs="*")
args = parser.parse_args()

if args.command == "discover":
    ports = choose_ports()
    print("|".join((str(ports["api"]), str(ports["frontend"]), str(ports["engine3d"]),
                    str(ports["engine2d"]), str(ports["theia"]), local_ip())))
else:
    if len(args.ports) != 5:
        raise SystemExit("write requires API, frontend, 3D, 2D, and Theia ports.")
    api, frontend, engine3d, engine2d, theia = (int(port) for port in args.ports)
    if any(not 1 <= port <= 65535 for port in (api, frontend, engine3d, engine2d, theia)):
        raise SystemExit("Port values must be between 1 and 65535.")
    output = Path(__file__).resolve().parents[1] / "dist" / "taskflow-runtime.js"
    output.parent.mkdir(parents=True, exist_ok=True)
    values = {"api": api, "frontend": frontend, "engine3d": engine3d, "engine2d": engine2d, "theia": theia}
    output.write_text(
        f"window.TASKFLOW_PORTS=Object.freeze({json.dumps(values, separators=(',', ':'))});\n",
        encoding="utf-8",
    )
