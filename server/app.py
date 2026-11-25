"""Local web server for the GenImage Forensics frontend.

Serves ../frontend and exposes either the published frontier ONNX detector or
the project's trained ResNet classifier over HTTP.

    python server/app.py

Then open http://127.0.0.1:8000

Endpoints
  GET  /api/health    model status, threshold, checkpoint
  POST /api/analyze   raw image bytes in the body (header X-Filename optional)
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import mimetypes
import os
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent          # repository root
FRONTEND = (ROOT / "frontend").resolve()
DEFAULT_CHECKPOINT = ROOT / "outputs" / "encoding_normalized" / "best.pt"
DEFAULT_METRICS = ROOT / "outputs" / "encoding_normalized_eval" / "metrics.json"
FRONTIER_MODEL = ROOT / "outputs" / "models" / "frontier" / "community_forensics_frontier_fp16.onnx"
FRONTIER_THRESHOLD = 0.65
FALLBACK_THRESHOLD = 0.5
MAX_BYTES = 20 * 1024 * 1024
MAX_TRACE_BYTES = 7 * 1024 * 1024  # base64 must fit Vision's 10 MB JSON limit
GENERATOR_SIZES = {128, 256, 512, 1024}


class Predictor:
    """Loads best.pt once and scores PIL images exactly as `genimage_pipeline.py infer` does."""

    def __init__(self, checkpoint: Path):
        sys.path.insert(0, str(ROOT / "src"))
        from genimage_pipeline import create_model, model_modules, normalize_encoding

        torch, _, _, _, models, transforms = model_modules()
        self.torch = torch
        state = torch.load(checkpoint, map_location="cpu", weights_only=False)
        self.model = create_model(models, False)
        self.model.load_state_dict(state["state_dict"])
        self.model.eval()
        self.size = int(state["size"])
        self.normalize_encoding = bool(state.get("normalize_encoding", False))
        self.normalize_image = normalize_encoding
        self.info = {k: state.get(k) for k in ("architecture", "epoch", "best_val_roc_auc")}
        # Same transform as infer(): square resize, tensor, ImageNet normalisation.
        self.transform = transforms.Compose([
            transforms.Resize((self.size,) * 2),
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ])
        self.lock = threading.Lock()

    def score(self, image) -> float:
        if self.normalize_encoding:
            image = self.normalize_image(image)
        with self.lock, self.torch.inference_mode():
            logits = self.model(self.transform(image).unsqueeze(0))
            return float(logits.softmax(1)[0, 1].item())


def read_threshold(path: Path | None) -> tuple[float, str]:
    if path and path.is_file():
        try:
            return float(json.loads(path.read_text(encoding="utf-8"))["threshold"]), str(path)
        except (KeyError, ValueError, json.JSONDecodeError):
            pass
    return FALLBACK_THRESHOLD, "EXPERIMENT_REPORT.md default"


def analyze(data: bytes, filename: str, predictor, threshold: float, model_name: str) -> dict:
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(data)) as source:
            fmt = (source.format or "").upper()
            mode = source.mode
            width, height = source.size
            exif_present = bool(source.getexif())
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise ValueError("Could not read the image. Use a JPEG, PNG, WEBP or BMP file.") from error

    started = time.perf_counter()
    score = predictor.score(image)
    elapsed = time.perf_counter() - started
    return {
        # The same four fields `infer` prints
        "image": filename,
        "ai_score_uncalibrated": score,
        "score_type": getattr(predictor, "score_type", "uncalibrated"),
        "assessment": "AI-generated" if score >= threshold else "real",
        "threshold": threshold,
        # Evidence and metadata for the UI
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "format": fmt,
        "mode": mode,
        "width": width,
        "height": height,
        "exif_present": exif_present,
        "square_generator_size": width == height and width in GENERATOR_SIZES,
        "inference_seconds": round(elapsed, 4),
        "model": model_name,
        "analyzedAt": datetime.now(timezone.utc).isoformat(),
        "source": "model",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "GenImageForensics/1.0"
    predictor = None
    threshold = FALLBACK_THRESHOLD
    health: dict = {}
    vision_api_key = ""
    serpapi_api_key = ""

    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            return self.send_json(HTTPStatus.OK, self.health)
        self.serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in {"/api/analyze", "/api/trace"}:
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint"})
        if path == "/api/analyze" and self.predictor is None:
            return self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Model is not loaded"})
        if path == "/api/trace" and not (self.serpapi_api_key or self.vision_api_key):
            return self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {
                "error": "Source tracing is not configured. Set SERPAPI_API_KEY or GOOGLE_CLOUD_VISION_API_KEY and restart the server."})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Send the image bytes in the request body"})
        limit = MAX_TRACE_BYTES if path == "/api/trace" and not self.serpapi_api_key else MAX_BYTES
        if length > limit:
            return self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "error": f"Image is too large for {'Google Cloud Vision (7 MB)' if limit == MAX_TRACE_BYTES else 'analysis or source search (20 MB)'}."})
        data = self.rfile.read(length)
        if path == "/api/trace":
            from web_trace import TraceError
            try:
                from PIL import Image
                with Image.open(io.BytesIO(data)) as image:
                    image.verify()
                if self.serpapi_api_key:
                    from serpapi_trace import search_image
                    result = search_image(data, self.serpapi_api_key)
                else:
                    from web_trace import search_image
                    result = search_image(data, self.vision_api_key)
            except (OSError, ValueError) as error:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid image: {error}"})
            except TraceError as error:
                return self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
            return self.send_json(HTTPStatus.OK, result)
        filename = unquote(self.headers.get("X-Filename") or "upload")[:200]
        try:
            result = analyze(data, filename, self.predictor, self.threshold, self.health.get("model", "model"))
        except ValueError as error:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except Exception as error:  # report, don't crash the server
            return self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Inference failed: {error}"})
        self.send_json(HTTPStatus.OK, result)

    def serve_static(self, path):
        target = (FRONTEND / (path.lstrip("/") or "index.html")).resolve()
        if FRONTEND not in target.parents:
            return self.send_json(HTTPStatus.FORBIDDEN, {"error": "Forbidden"})
        if not target.is_file():
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main(argv=None, predictor_factory=Predictor):
    parser = argparse.ArgumentParser(description="Serve the GenImage Forensics frontend with the trained model.")
    parser.add_argument("--detector", choices=("frontier", "resnet"), default="frontier")
    parser.add_argument("--checkpoint", type=Path, default=None)
    parser.add_argument("--metrics", type=Path, default=None,
                        help="metrics.json from `evaluate`; its threshold is used when --threshold is not given")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    checkpoint = args.checkpoint or (FRONTIER_MODEL if args.detector == "frontier" else DEFAULT_CHECKPOINT)

    if args.threshold is not None:
        threshold, threshold_source = args.threshold, "--threshold"
    elif args.detector == "frontier" and args.metrics is None:
        threshold, threshold_source = FRONTIER_THRESHOLD, "published frontier threshold"
    else:
        threshold, threshold_source = read_threshold(args.metrics or DEFAULT_METRICS)

    if not checkpoint.is_file():
        parser.error(f"model not found: {checkpoint}\nSee server/README.md for the model download command")
    print(f"Loading {checkpoint} ...", flush=True)
    if args.detector == "frontier":
        sys.path.insert(0, str(ROOT / "src"))
        from detectra_predictor import FrontierPredictor
        predictor = FrontierPredictor(checkpoint)
    else:
        predictor = predictor_factory(checkpoint)
    info = getattr(predictor, "info", {}) or {}

    Handler.predictor = predictor
    Handler.threshold = threshold
    Handler.vision_api_key = os.environ.get("GOOGLE_CLOUD_VISION_API_KEY", "").strip()
    Handler.serpapi_api_key = os.environ.get("SERPAPI_API_KEY", "").strip()
    Handler.health = {
        "status": "ok",
        "model": info.get("architecture") or args.detector,
        "checkpoint": checkpoint.name,
        "input_size": getattr(predictor, "size", None),
        "normalize_encoding": getattr(predictor, "normalize_encoding", False),
        "threshold": threshold,
        "threshold_source": threshold_source,
        "score_type": getattr(predictor, "score_type", "uncalibrated"),
        "best_val_roc_auc": info.get("best_val_roc_auc"),
        "evaluation": ({
            "accuracy": 0.9262857142857143, "precision": 0.9869451697127938,
            "recall": 0.864, "f1": 0.9213893967093236,
            "rocAuc": 0.9860832653061224, "ap": 0.9880969345881176,
            "fpr": 10 / 875, "fnr": 119 / 875,
            "confusion": {"tn": 865, "fp": 10, "fn": 119, "tp": 756},
            "count": 1750,
        } if args.detector == "frontier" and checkpoint.resolve() == FRONTIER_MODEL.resolve() else None),
        "features": {"classification": True, "generator_attribution": False, "harm_assessment": False,
                     "source_tracing": bool(Handler.serpapi_api_key or Handler.vision_api_key), "report_submission": False},
        "trace_provider": ("Google Lens via SerpApi" if Handler.serpapi_api_key else
                           "Google Cloud Vision Web Detection" if Handler.vision_api_key else None),
    }
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Model ready · threshold {threshold:.4f} ({threshold_source})")
    print(f"Open http://{args.host}:{args.port}  (Ctrl+C to stop)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
