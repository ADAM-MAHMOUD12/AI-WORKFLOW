from __future__ import annotations

import unittest

from download_progress import (
    advance_download,
    begin_download,
    download_status,
    finish_download,
    huggingface_tqdm_class,
)


class DownloadProgressTests(unittest.TestCase):
    def test_reports_transferred_and_remaining_bytes(self):
        begin_download("test-download-progress", 100, 10)
        advance_download("test-download-progress", 35)

        status = download_status("test-download-progress")
        self.assertEqual(status["state"], "downloading")
        self.assertEqual(status["bytes_downloaded"], 45)
        self.assertEqual(status["bytes_total"], 100)

    def test_caps_hugging_face_transfer_progress_at_known_total(self):
        begin_download("test-download-tqdm", 10)
        progress_class = huggingface_tqdm_class("test-download-tqdm")
        with progress_class(total=10, disable=True) as progress:
            progress.update(12)

        status = download_status("test-download-tqdm")
        self.assertEqual(status["bytes_downloaded"], 10)

    def test_marks_failed_download_without_claiming_completion(self):
        begin_download("test-download-failure", 80)
        advance_download("test-download-failure", 24)
        finish_download("test-download-failure", False, "connection lost")

        status = download_status("test-download-failure")
        self.assertEqual(status["state"], "error")
        self.assertEqual(status["bytes_downloaded"], 24)
        self.assertEqual(status["error"], "connection lost")


if __name__ == "__main__":
    unittest.main()
