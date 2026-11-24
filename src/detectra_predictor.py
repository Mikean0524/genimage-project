"""CPU inference for the pinned Detectra v3 ONNX model.

Model: https://huggingface.co/TensorFold/detectra-v1
Preprocessing follows the model card: resize shortest edge to 440, center crop
384, scale to [0, 1], then ImageNet normalize.
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MODEL_SHA256 = "1414b9aafaa01a644ed706224973f09b53a1388282104409862df9893b1b962b"
DEFAULT_MODEL = Path(__file__).resolve().parent.parent / "outputs/models/detectra/model.onnx"
FRONTIER_MODEL = Path(__file__).resolve().parent.parent / "outputs/models/frontier/community_forensics_frontier_fp16.onnx"
FRONTIER_INTERCEPT = -0.7403357915937764
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(image: Image.Image) -> np.ndarray:
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    scale = 440 / min(width, height)
    image = image.resize((round(width * scale), round(height * scale)), Image.Resampling.BILINEAR)
    left = (image.width - 384) // 2
    top = (image.height - 384) // 2
    image = image.crop((left, top, left + 384, top + 384))
    pixels = np.asarray(image, dtype=np.float32) / 255.0
    pixels = (pixels - MEAN) / STD
    return np.ascontiguousarray(pixels.transpose(2, 0, 1)[None])


class DetectraPredictor:
    def __init__(self, model_path: Path = DEFAULT_MODEL):
        import onnxruntime as ort

        self.model_path = Path(model_path)
        self.session = ort.InferenceSession(str(self.model_path), providers=["CPUExecutionProvider"])
        self.size = 384
        self.info = {"architecture": "Detectra ViT-S/16", "epoch": "published", "best_val_roc_auc": None}
        self.normalize_encoding = False
        self.score_type = "uncalibrated"

    def score(self, image: Image.Image) -> float:
        logit = float(self.session.run(["logit"], {"pixel_values": preprocess(image)})[0][0, 0])
        return 1.0 / (1.0 + math.exp(-logit))


class FrontierPredictor:
    """Published frontier model with its frozen bias calibration."""

    def __init__(self, model_path: Path = FRONTIER_MODEL):
        import onnxruntime as ort

        self.model_path = Path(model_path)
        self.session = ort.InferenceSession(str(self.model_path), providers=["CPUExecutionProvider"])
        self.size = 384
        self.info = {"architecture": "Community Forensics frontier ViT-S/16", "epoch": "published",
                     "best_val_roc_auc": None}
        self.normalize_encoding = False
        self.score_type = "published_bias_calibrated"

    def score(self, image: Image.Image) -> float:
        logit = float(self.session.run(["logits"], {"images": preprocess(image)})[0][0, 0])
        return 1.0 / (1.0 + math.exp(-(logit + FRONTIER_INTERCEPT)))
