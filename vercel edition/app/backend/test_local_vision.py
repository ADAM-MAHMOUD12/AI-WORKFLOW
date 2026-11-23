from __future__ import annotations

import base64
import io
import unittest

from fastapi import HTTPException
import numpy as np
from PIL import Image

from local_vision import (
    MAX_IMAGE_EDGE,
    MAX_MODEL_SIZE_BYTES,
    MODEL_FILE_SIZES,
    MODEL_WEIGHT_FILES,
    model_files,
    _parse_generated_regions,
    _bounded_regions,
    update_decoder_cache,
    decode_image,
    model_status,
)


def image_data(width: int, height: int) -> str:
    image = Image.new("RGB", (width, height), "white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


class LocalVisionTests(unittest.TestCase):
    def test_decodes_supported_image_data_locally(self):
        image = decode_image(image_data(32, 24))

        self.assertEqual(image.size, (32, 24))
        self.assertEqual(image.mode, "RGB")

    def test_rejects_invalid_or_oversized_images(self):
        with self.assertRaises(HTTPException) as invalid:
            decode_image("data:image/png;base64,not-base64!")
        self.assertEqual(invalid.exception.status_code, 422)

        with self.assertRaises(HTTPException) as oversized:
            decode_image(image_data(MAX_IMAGE_EDGE + 1, 1))
        self.assertEqual(oversized.exception.status_code, 413)

    def test_bounds_and_sanitizes_detected_regions(self):
        regions = _bounded_regions(
            {
                "labels": ["object", "invalid"],
                "bboxes": [[-5, 2, 40, 30], [float("nan"), 1, 3, 4]],
            },
            32,
            24,
        )

        self.assertEqual(regions, [{"label": "object", "box": [0.0, 2.0, 32.0, 24.0]}])

    def test_model_status_exposes_the_installation_budget(self):
        status = model_status()

        self.assertEqual(status["max_size_bytes"], MAX_MODEL_SIZE_BYTES)
        self.assertIsInstance(status["installed"], bool)
        self.assertIsInstance(status["runtime_ready"], bool)

    def test_pinned_model_sizes_match_the_exact_download_total(self):
        self.assertEqual(set(model_files()), set(MODEL_FILE_SIZES))
        self.assertEqual(sum(MODEL_FILE_SIZES.values()), 291_714_505)
        self.assertEqual(sum(MODEL_FILE_SIZES[name] for name in MODEL_WEIGHT_FILES), 287_485_250)

    def test_parses_object_and_ocr_regions_from_florence_tokens(self):
        object_result = _parse_generated_regions(
            "<od>blue rectangle<loc_100><loc_200><loc_500><loc_800></od>",
            (1000, 500),
            4,
        )
        ocr_result = _parse_generated_regions(
            "<ocr>W2M<loc_100><loc_100><loc_500><loc_100><loc_500><loc_300><loc_100><loc_300></ocr>",
            (1000, 500),
            8,
        )

        self.assertEqual(object_result["labels"], ["blue rectangle"])
        self.assertEqual(object_result["bboxes"], [[100, 100, 500, 400]])
        self.assertEqual(ocr_result["labels"], ["W2M"])
        self.assertEqual(ocr_result["quad_boxes"], [[100, 50, 500, 50, 500, 150, 100, 150]])

    def test_retains_cross_attention_cache_when_onnx_returns_empty_placeholders(self):
        key = "past_key_values.0.encoder.key"
        previous = {key: np.ones((1, 12, 4, 64), dtype=np.float32)}
        outputs = [type("Output", (), {"name": "present.0.encoder.key"})()]
        values = [np.empty((0, 12, 1, 64), dtype=np.float32)]

        updated = update_decoder_cache(previous, outputs, values)

        self.assertIs(updated[key], previous[key])


if __name__ == "__main__":
    unittest.main()
