import argparse
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen


parser = argparse.ArgumentParser(description="Wait until a local HTTP service responds successfully.")
parser.add_argument("url")
parser.add_argument("--timeout", type=int, default=30)
args = parser.parse_args()

deadline = time.monotonic() + args.timeout
last_error = "no response"
while time.monotonic() < deadline:
    try:
        with urlopen(args.url, timeout=2) as response:
            if 200 <= response.status < 400:
                raise SystemExit(0)
            last_error = f"HTTP {response.status}"
    except (OSError, URLError, TimeoutError) as error:
        last_error = str(error)
    time.sleep(1)

print(f"Timed out waiting for {args.url}: {last_error}", file=sys.stderr)
raise SystemExit(1)
