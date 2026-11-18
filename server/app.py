"""Local web server for the GenImage Forensics frontend.

Serves ../frontend and exposes the trained classifier over HTTP. It uses only the
Python standard library plus the packages already in requirements-ml.txt, and it
imports the existing pipeline without modifying it.

    python server/app.py --checkpoint outputs/baseline/best.pt

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
DEFAULT_CHECKPOINT = ROOT / "outputs" / "baseline" / "best.pt"
DEFAULT_METRICS = ROOT / "outputs" / "evaluation" / "metrics.json"
FALLBACK_THRESHOLD = 0.2714381218                      # from outputs/EXPERIMENT_REPORT.md
MAX_BYTES = 20 * 1024 * 1024
GENERATOR_SIZES = {128, 256, 512, 1024}


class Predictor:
    """Loads best.pt once and scores PIL images exactly as `genimage_pipeline.py infer` does."""

    def __init__(self, checkpoint: Path):
        sys.path.insert(0, str(ROOT / "src"))
        from genimage_pipeline import create_model, model_modules  # existing code, unchanged

        torch, _, _, _, models, transforms = model_modules()
        self.torch = torch
        state = torch.load(checkpoint, map_location="cpu", weights_only=False)
        self.model = create_model(models, False)
        self.model.load_state_dict(state["state_dict"])
        self.model.eval()
        self.size = int(state["size"])
        self.info = {k: state.get(k) for k in ("architecture", "epoch", "best_val_roc_auc")}
        # Same transform as infer(): square resize, tensor, ImageNet normalisation.
        self.transform = transforms.Compose([
            transforms.Resize((self.size,) * 2),
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ])
        self.lock = threading.Lock()

    def score(self, image) -> float:
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
        if urlparse(self.path).path != "/api/analyze":
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint"})
        if self.predictor is None:
            return self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Model is not loaded"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Send the image bytes in the request body"})
        if length > MAX_BYTES:
            return self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Image is larger than 20 MB"})
        data = self.rfile.read(length)
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
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--metrics", type=Path, default=DEFAULT_METRICS,
                        help="metrics.json from `evaluate`; its threshold is used when --threshold is not given")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    if args.threshold is not None:
        threshold, threshold_source = args.threshold, "--threshold"
    else:
        threshold, threshold_source = read_threshold(args.metrics)

    if not args.checkpoint.is_file():
        parser.error(f"checkpoint not found: {args.checkpoint}\n"
                     "Train first (see docs/RUN_PIPELINE.md) or pass --checkpoint path/to/best.pt")
    print(f"Loading {args.checkpoint} …", flush=True)
    predictor = predictor_factory(args.checkpoint)
    info = getattr(predictor, "info", {}) or {}

    Handler.predictor = predictor
    Handler.threshold = threshold
    Handler.health = {
        "status": "ok",
        "model": f"ResNet-50 ({info.get('architecture') or 'resnet50'}, epoch {info.get('epoch', '?')})",
        "checkpoint": args.checkpoint.name,
        "input_size": getattr(predictor, "size", None),
        "threshold": threshold,
        "threshold_source": threshold_source,
        "best_val_roc_auc": info.get("best_val_roc_auc"),
        "features": {"classification": True, "generator_attribution": False, "harm_assessment": False,
                     "source_tracing": False, "report_submission": False},
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
