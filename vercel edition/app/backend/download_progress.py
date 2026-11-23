from __future__ import annotations

from threading import Lock
from typing import Any


_LOCK = Lock()
_DOWNLOADS: dict[str, dict[str, Any]] = {}


def begin_download(download_id: str, total_bytes: int | None, downloaded_bytes: int = 0) -> None:
    with _LOCK:
        _DOWNLOADS[download_id] = {
            "id": download_id,
            "state": "downloading",
            "bytes_downloaded": max(0, downloaded_bytes),
            "bytes_total": max(0, total_bytes) if total_bytes is not None else None,
            "error": None,
        }


def advance_download(download_id: str, byte_count: int) -> None:
    if byte_count <= 0:
        return
    with _LOCK:
        progress = _DOWNLOADS.get(download_id)
        if not progress or progress["state"] != "downloading":
            return
        downloaded = progress["bytes_downloaded"] + byte_count
        total = progress["bytes_total"]
        progress["bytes_downloaded"] = min(downloaded, total) if total else downloaded


def finish_download(download_id: str, installed: bool, error: str | None = None) -> None:
    with _LOCK:
        progress = _DOWNLOADS.get(download_id)
        if not progress:
            return
        total = progress["bytes_total"]
        if installed:
            progress["state"] = "complete"
            progress["error"] = None
            if total:
                progress["bytes_downloaded"] = total
        else:
            progress["state"] = "error"
            progress["error"] = error or "لم يكتمل تنزيل النموذج والتحقق منه."


def download_status(download_id: str) -> dict[str, Any]:
    with _LOCK:
        progress = _DOWNLOADS.get(download_id)
        if not progress:
            return {
                "id": download_id,
                "state": "idle",
                "bytes_downloaded": 0,
                "bytes_total": None,
                "error": None,
            }
        return dict(progress)


def huggingface_tqdm_class(download_id: str):
    from tqdm.auto import tqdm

    class DownloadProgressBar(tqdm):
        def update(self, n: int = 1):
            result = super().update(n)
            advance_download(download_id, n)
            return result

    return DownloadProgressBar
