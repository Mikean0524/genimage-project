# GenImage Forensics — model server

Runs the detector behind the frontend. The default is a published ONNX model; the project's trained ResNet is also available.

## Run

From the repository root:

```powershell
python -m pip install -r requirements-server.txt
python src/download_frontier_model.py
python server/app.py
```

Open http://127.0.0.1:8000. The top bar turns green and says "Connected to your model".

| Option | Default | Meaning |
|---|---|---|
| `--detector` | `frontier` | `frontier` uses the published ONNX model; `resnet` uses this project's trained checkpoint |
| `--checkpoint` | detector-specific | Override model file path |
| `--metrics` | none for frontier | Override threshold from a metrics JSON file |
| `--threshold` | `0.65` for frontier | Decision threshold |
| `--host` / `--port` | `127.0.0.1` / `8000` | Where to listen |

## API

`GET /api/health` returns the model, checkpoint, threshold and which features are real.

`POST /api/analyze` takes the raw image bytes as the request body (optional `X-Filename` header, 20 MB limit) and returns:

```json
{
  "image": "photo.png",
  "ai_score_uncalibrated": 0.97,
  "score_type": "published_bias_calibrated",
  "assessment": "AI-generated",
  "threshold": 0.65,
  "sha256": "…", "size": 123456, "format": "PNG", "mode": "RGB",
  "width": 512, "height": 512, "exif_present": false,
  "square_generator_size": true, "inference_seconds": 0.05,
  "model": "Community Forensics frontier ViT-S/16", "analyzedAt": "…", "source": "model"
}
```

The server uses the frontier detector by default. It applies EXIF orientation, RGB conversion, short-edge resize to 440, a 384-pixel center crop, ImageNet normalization, and the published bias calibration. The old ResNet path remains available with `--detector resnet`; for that path the preprocessing matches `genimage_pipeline.py infer`.
The `ai_score_uncalibrated` field name is retained for frontend compatibility; `score_type` reports the actual calibration mode.

The frontier model is [Thermostatic's August 2026 Community Forensics detector](https://huggingface.co/Thermostatic/community-forensics-frontier-detector-2026-08), released under MIT. The download script verifies the published ONNX SHA-256. On the local 1,750-image GenImage-derived test set, its fixed 0.65 threshold gave 92.63% accuracy: 10/875 real images flagged as AI and 119/875 AI images missed. Three newly generated images were scored 0.6775, 1.0000, and 0.9999. These figures are screening evidence, not proof of provenance or a guarantee for future generators.

## What is real and what is not

Real: AI-vs-real score, verdict, threshold, SHA-256, format/size/EXIF metadata.
Not built yet (the UI says so): generator attribution, person and harm detection, source tracing, report submission.
Because harm can't be assessed, auto-report won't fire while "only when high harm" is switched on.

Without the server (opening `frontend/index.html` directly), the frontend runs in demo mode with simulated scores.
