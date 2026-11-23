import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class SinglePageHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        requested_path = Path(self.translate_path(self.path))
        if not requested_path.is_file() and not Path(urlsplit(self.path).path).suffix:
            self.path = "/index.html"
        return super().send_head()


parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
parser.add_argument("host")
parser.add_argument("port", type=int)
args = parser.parse_args()
directory = args.directory.resolve()
if not (directory / "index.html").is_file():
    raise FileNotFoundError(f"Static application entry point is missing: {directory / 'index.html'}")

handler = partial(SinglePageHandler, directory=str(directory))
ThreadingHTTPServer((args.host, args.port), handler).serve_forever()
