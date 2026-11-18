from __future__ import annotations

import asyncio
import base64
import binascii
import importlib.util
import io
import math
import re
import threading
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from download_progress import (
    begin_download,
    finish_download,
    huggingface_tqdm_class,
)


MODEL_REPOSITORY = "onnx-community/Florence-2-base-ft"
MODEL_REVISION = "e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f"
MODEL_DOWNLOAD_ID = "florence-2"
MODEL_DIRECTORY = Path(__file__).resolve().parent / "data" / "w2m-models" / "florence-2-base-ft"
MODEL_FILE_SIZES = {
    "onnx/vision_encoder_q4f16.onnx": 62_416_644,
    "onnx/embed_tokens_q4f16.onnx": 78_780_309,
    "onnx/encoder_model_q4f16.onnx": 25_705_965,
    "onnx/decoder_model_q4f16.onnx": 56_188_858,
    "onnx/decoder_model_merged_q4.onnx": 64_393_474,
    "added_tokens.json": 22_410,
    "config.json": 5_432,
    "generation_config.json": 292,
    "merges.txt": 456_318,
    "preprocessor_config.json": 2_673,
    "special_tokens_map.json": 146_627,
    "tokenizer.json": 2_297_961,
    "tokenizer_config.json": 197_658,
    "vocab.json": 1_099_884,
}
MODEL_WEIGHT_FILES = tuple(name for name in MODEL_FILE_SIZES if name.startswith("onnx/"))
PROCESSOR_FILES = tuple(name for name in MODEL_FILE_SIZES if not name.startswith("onnx/"))
MAX_MODEL_SIZE_BYTES = 500_000_000
MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_EDGE = 2048
MODEL_DOWNLOAD_LOCK = asyncio.Lock()
MODEL_LOAD_LOCK = threading.Lock()
INFERENCE_LOCK = threading.Lock()
MODEL_RUNTIME: Any | None = None
TASK_PROMPTS = {
    "<MORE_DETAILED_CAPTION>": "Describe with a paragraph what is shown in the image.",
    "<OD>": "Locate the objects with category name in the image.",
    "<OCR_WITH_REGION>": "What is the text in the image, with regions?",
}
LOCATION_TOKEN = re.compile(r"<loc_(\d+)>")
REGION_PATTERN = re.compile(r"(?P<label>[^<]*)(?P<locations>(?:<loc_\d+>){4,})")


def model_files() -> tuple[str, ...]:
    return MODEL_WEIGHT_FILES + PROCESSOR_FILES


def model_installed() -> bool:
    return all(
        (MODEL_DIRECTORY / name).is_file() and (MODEL_DIRECTORY / name).stat().st_size == size
        for name, size in MODEL_FILE_SIZES.items()
    ) and sum(MODEL_FILE_SIZES[name] for name in MODEL_WEIGHT_FILES) <= MAX_MODEL_SIZE_BYTES


def model_size_bytes() -> int:
    return sum(
        (MODEL_DIRECTORY / name).stat().st_size
        for name in MODEL_WEIGHT_FILES
        if (MODEL_DIRECTORY / name).is_file()
    )


def model_status() -> dict[str, Any]:
    runtime_ready = all(
        importlib.util.find_spec(module) is not None
        for module in ("huggingface_hub", "numpy", "onnxruntime", "PIL", "transformers")
    )
    return {
        "engine": "Florence-2-base-ft · ONNX Runtime CPU",
        "installed": model_installed(),
        "loaded": MODEL_RUNTIME is not None,
        "runtime_ready": runtime_ready,
        "size_bytes": model_size_bytes(),
        "max_size_bytes": MAX_MODEL_SIZE_BYTES,
        "offline_after_download": True,
    }


def download_model() -> dict[str, Any]:
    if not model_status()["runtime_ready"]:
        raise HTTPException(
            status_code=503,
            detail="أعد تشغيل المشغّل لتثبيت مكونات الرؤية المحلية قبل تنزيل النموذج.",
        )
    try:
        from huggingface_hub import HfApi, snapshot_download
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail="مكتبات تنزيل نموذج الرؤية غير مثبّتة. أعد تشغيل المشغّل لتثبيتها.",
        ) from exc

    MODEL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    repository_files = HfApi().get_paths_info(
        repo_id=MODEL_REPOSITORY,
        paths=list(model_files()),
        revision=MODEL_REVISION,
    )
    file_sizes = {
        item.path: item.size
        for item in repository_files
        if isinstance(getattr(item, "size", None), int)
    }
    if any(name not in file_sizes for name in model_files()):
        raise HTTPException(status_code=502, detail="تعذّر معرفة الحجم الدقيق لكل ملفات Florence-2.")
    if any(file_sizes[name] != expected for name, expected in MODEL_FILE_SIZES.items()):
        raise HTTPException(status_code=502, detail="أحجام ملفات Florence-2 لا تطابق نسخة النموذج المثبتة.")
    total_bytes = sum(file_sizes.values())
    existing_bytes = sum(
        expected
        for name, expected in MODEL_FILE_SIZES.items()
        if (MODEL_DIRECTORY / name).is_file() and (MODEL_DIRECTORY / name).stat().st_size == expected
    )
    begin_download(MODEL_DOWNLOAD_ID, total_bytes, min(existing_bytes, total_bytes))
    try:
        snapshot_download(
            repo_id=MODEL_REPOSITORY,
            revision=MODEL_REVISION,
            local_dir=str(MODEL_DIRECTORY),
            allow_patterns=list(model_files()),
            tqdm_class=huggingface_tqdm_class(MODEL_DOWNLOAD_ID),
        )
    finally:
        finish_download(MODEL_DOWNLOAD_ID, model_installed())
    missing = [name for name in model_files() if not (MODEL_DIRECTORY / name).is_file()]
    if missing:
        raise HTTPException(
            status_code=502,
            detail=f"اكتمل تنزيل Florence-2 لكن ملفات النموذج غير مكتملة: {', '.join(missing)}.",
        )
    size = model_size_bytes()
    if size > MAX_MODEL_SIZE_BYTES:
        raise HTTPException(
            status_code=502,
            detail=f"حجم ملفات Florence-2 ({size} بايت) يتجاوز الحد المسموح 500 ميغابايت.",
        )
    return model_status()


def load_model():
    global MODEL_RUNTIME
    with MODEL_LOAD_LOCK:
        if MODEL_RUNTIME is not None:
            return MODEL_RUNTIME
        if not model_installed():
            raise HTTPException(
                status_code=409,
                detail="نزّل نموذج الرؤية المحلي W2M أولًا من استوديو التصميم.",
            )
        try:
            import onnxruntime as ort
            from transformers import AutoImageProcessor, AutoTokenizer
        except ImportError as exc:
            raise HTTPException(
                status_code=503,
                detail="محرك Florence-2 غير مثبّت. أعد تشغيل المشغّل لتثبيت الاعتمادات.",
            ) from exc

        options = ort.SessionOptions()
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        options.intra_op_num_threads = max(1, min(2, os_cpu_count()))
        options.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        model_directory = MODEL_DIRECTORY
        try:
            sessions = {
                name: ort.InferenceSession(
                    str(model_directory / path),
                    sess_options=options,
                    providers=providers,
                )
                for name, path in zip(
                    ("vision", "embeddings", "encoder", "prefill", "decoder"),
                    MODEL_WEIGHT_FILES,
                    strict=True,
                )
            }
            image_processor = AutoImageProcessor.from_pretrained(
                str(model_directory),
                local_files_only=True,
                trust_remote_code=False,
            )
            tokenizer = AutoTokenizer.from_pretrained(
                str(model_directory),
                local_files_only=True,
                trust_remote_code=False,
            )
            processor = FlorenceOnnxProcessor(image_processor, tokenizer)
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            raise HTTPException(
                status_code=503,
                detail=f"تعذّر تحميل Florence-2 محليًا: {exc}",
            ) from exc

        MODEL_RUNTIME = {"sessions": sessions, "processor": processor}
        return MODEL_RUNTIME


def os_cpu_count() -> int:
    import os

    return os.cpu_count() or 1


class FlorenceOnnxProcessor:
    def __init__(self, image_processor: Any, tokenizer: Any):
        self.image_processor = image_processor
        self.tokenizer = tokenizer

    def __call__(self, *, text: str, images: Any, return_tensors: str, do_resize: bool):
        prompt = TASK_PROMPTS.get(text, text)
        image_inputs = self.image_processor(
            images,
            return_tensors=return_tensors,
            do_resize=do_resize,
        )
        text_inputs = self.tokenizer(
            prompt,
            return_tensors=return_tensors,
            return_attention_mask=True,
        )
        return {**text_inputs, **image_inputs}

    def batch_decode(self, sequences: Any, skip_special_tokens: bool):
        return self.tokenizer.batch_decode(sequences, skip_special_tokens=skip_special_tokens)

    def post_process_generation(self, text: str, task: str, image_size: tuple[int, int]):
        if task == "<MORE_DETAILED_CAPTION>":
            result = re.sub(r"</?(?:s|pad)>", "", text).strip()
        else:
            location_count = 8 if task == "<OCR_WITH_REGION>" else 4
            result = _parse_generated_regions(text, image_size, location_count)
        return {task: result}


def _parse_generated_regions(
    text: str,
    image_size: tuple[int, int],
    location_count: int,
) -> dict[str, list[Any]]:
    width, height = image_size
    labels: list[str] = []
    boxes: list[list[int]] = []
    for match in REGION_PATTERN.finditer(text):
        locations = [int(value) for value in LOCATION_TOKEN.findall(match.group("locations"))]
        if len(locations) < location_count:
            continue
        coordinates = [
            int((locations[index] + 0.5) * (width if index % 2 == 0 else height) / 1000)
            for index in range(location_count)
        ]
        label = re.sub(r"<[^>]*>", "", match.group("label")).rsplit(">", 1)[-1].strip()
        if not label:
            continue
        labels.append(label)
        boxes.append(coordinates)
    if location_count == 8:
        return {"labels": labels, "quad_boxes": boxes}
    return {"labels": labels, "bboxes": boxes}


def decode_image(image_data: str):
    from PIL import Image, UnidentifiedImageError

    match = re.fullmatch(r"data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", image_data)
    if not match:
        raise HTTPException(status_code=422, detail="صيغة الصورة غير صالحة؛ استخدم JPEG أو PNG أو WebP.")
    try:
        content = base64.b64decode(match.group(2), validate=True)
        if not content or len(content) > MAX_IMAGE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="يجب ألا يتجاوز حجم الصورة 4 ميغابايت.")
        with Image.open(io.BytesIO(content)) as probe:
            if probe.width > MAX_IMAGE_EDGE or probe.height > MAX_IMAGE_EDGE:
                raise HTTPException(status_code=413, detail="أبعاد الصورة تتجاوز الحد المسموح 2048×2048.")
            probe.verify()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        return image
    except (binascii.Error, UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=422, detail="تعذّر قراءة الصورة؛ اختر ملف صورة صالحًا.") from exc


def canonical_cache_name(name: str) -> str:
    return re.sub(r"^present\.", "past_key_values.", name)


def update_decoder_cache(previous: dict[str, Any], outputs: Any, values: Any) -> dict[str, Any]:
    updated: dict[str, Any] = {}
    for output, value in zip(outputs, values, strict=True):
        name = canonical_cache_name(output.name)
        updated[name] = previous[name] if value.size == 0 and name in previous else value
    return updated


def run_generation(runtime: dict[str, Any], image: Any, task: str, max_new_tokens: int) -> Any:
    import numpy as np

    sessions = runtime["sessions"]
    processor = runtime["processor"]
    inputs = processor(text=task, images=image, return_tensors="np", do_resize=True)
    image_features = sessions["vision"].run(None, {"pixel_values": inputs["pixel_values"]})[0]
    text_embeddings = sessions["embeddings"].run(None, {"input_ids": inputs["input_ids"]})[0]
    image_mask = np.ones(image_features.shape[:2], dtype=np.int64)
    text_mask = np.ones(text_embeddings.shape[:2], dtype=np.int64)
    embeddings = np.concatenate((image_features, text_embeddings), axis=1)
    attention_mask = np.concatenate((image_mask, text_mask), axis=1)
    encoder_hidden_states = sessions["encoder"].run(
        None,
        {"inputs_embeds": embeddings, "attention_mask": attention_mask},
    )[0]
    prefill = sessions["prefill"]
    prefill_result = prefill.run(
        None,
        {
            "inputs_embeds": embeddings[:, -1:],
            "encoder_hidden_states": encoder_hidden_states,
            "encoder_attention_mask": attention_mask,
        },
    )
    cache = {
        canonical_cache_name(output.name): value
        for output, value in zip(prefill.get_outputs()[1:], prefill_result[1:], strict=True)
    }
    decoder = sessions["decoder"]
    generated: list[int] = []
    eos_token_id = processor.tokenizer.eos_token_id or 2
    next_token_logits = prefill_result[0][:, -1, :]
    for _ in range(max_new_tokens):
        token_id = int(np.argmax(next_token_logits, axis=-1)[0])
        generated.append(token_id)
        if token_id == eos_token_id:
            break
        token_embedding = sessions["embeddings"].run(
            None,
            {"input_ids": np.asarray([[token_id]], dtype=np.int64)},
        )[0]
        decoder_inputs: dict[str, Any] = {}
        for item in decoder.get_inputs():
            name = item.name
            if name == "use_cache_branch":
                decoder_inputs[name] = np.asarray([True], dtype=np.bool_)
            elif name == "inputs_embeds":
                decoder_inputs[name] = token_embedding
            elif name == "encoder_hidden_states":
                decoder_inputs[name] = encoder_hidden_states
            elif name == "encoder_attention_mask":
                decoder_inputs[name] = attention_mask
            elif name in cache:
                decoder_inputs[name] = cache[name]
            else:
                raise RuntimeError(f"Unsupported Florence-2 decoder input: {name}")
        decoder_result = decoder.run(None, decoder_inputs)
        cache = update_decoder_cache(cache, decoder.get_outputs()[1:], decoder_result[1:])
        next_token_logits = decoder_result[0][:, -1, :]
    generated_text = processor.batch_decode([generated], skip_special_tokens=False)[0]
    return processor.post_process_generation(generated_text, task=task, image_size=image.size).get(task)


def _bounded_regions(value: Any, image_width: int, image_height: int, limit: int = 80) -> list[dict[str, Any]]:
    if not isinstance(value, dict):
        return []
    labels = value.get("labels", [])
    boxes = value.get("bboxes", value.get("quad_boxes", []))
    if not isinstance(labels, list) or not isinstance(boxes, list):
        return []
    regions: list[dict[str, Any]] = []
    for label, coordinates in zip(labels[:limit], boxes[:limit]):
        if not isinstance(coordinates, (list, tuple)) or not isinstance(label, (str, int, float)):
            continue
        numbers = [
            float(item) for item in coordinates
            if isinstance(item, (int, float)) and math.isfinite(float(item))
        ]
        if len(numbers) < 4:
            continue
        xs, ys = numbers[0::2], numbers[1::2]
        if not xs or not ys:
            continue
        x1 = max(0.0, min(float(image_width), min(xs)))
        y1 = max(0.0, min(float(image_height), min(ys)))
        x2 = max(x1, min(float(image_width), max(xs)))
        y2 = max(y1, min(float(image_height), max(ys)))
        regions.append({
            "label": str(label)[:160],
            "box": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
        })
    return regions


def analyze_image(image_data: str, mode: str = "full") -> dict[str, Any]:
    if mode not in {"full", "caption"}:
        raise HTTPException(status_code=422, detail="وضع تحليل الصورة غير مدعوم.")
    image = decode_image(image_data)
    runtime = load_model()
    width, height = image.size
    with INFERENCE_LOCK:
        caption = run_generation(runtime, image, "<MORE_DETAILED_CAPTION>", 160)
        objects = run_generation(runtime, image, "<OD>", 256) if mode == "full" else None
        text_regions = run_generation(runtime, image, "<OCR_WITH_REGION>", 256) if mode == "full" else None
    return {
        "engine": "Florence-2-base-ft · ONNX Runtime CPU",
        "width": width,
        "height": height,
        "caption": str(caption or "")[:4000],
        "objects": _bounded_regions(objects, width, height),
        "text_regions": _bounded_regions(text_regions, width, height),
        "local_only": True,
    }
