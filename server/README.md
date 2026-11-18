# GenImage Forensics — model server

Runs the trained classifier behind the frontend. It uses only the Python standard library and the packages
already in `requirements-ml.txt`, and it imports `src/genimage_pipeline.py` without modifying it.

## Run

From the repository root, after training (see `docs/RUN_PIPELINE.md`):

```powershell
python -m pip install -r requirements-ml.txt
python server/app.py --checkpoint outputs/baseline/best.pt
```

Open http://127.0.0.1:8000. The top bar turns green and says "Connected to your model".

| Option | Default | Meaning |
|---|---|---|
| `--checkpoint` | `outputs/baseline/best.pt` | Checkpoint written by `train` |
| `--metrics` | `outputs/evaluation/metrics.json` | Its `threshold` is used if `--threshold` isn't given |
| `--threshold` | from metrics, else `0.2714381218` | Decision threshold |
| `--host` / `--port` | `127.0.0.1` / `8000` | Where to listen |

## API

`GET /api/health` returns the model, checkpoint, threshold and which features are real.

`POST /api/analyze` takes the raw image bytes as the request body (optional `X-Filename` header, 20 MB limit) and returns:

```json
{
  "image": "photo.png",
  "ai_score_uncalibrated": 0.97,
  "assessment": "AI-generated",
  "threshold": 0.2714381218,
  "sha256": "…", "size": 123456, "format": "PNG", "mode": "RGB",
  "width": 512, "height": 512, "exif_present": false,
  "square_generator_size": true, "inference_seconds": 0.05,
  "model": "ResNet-50 (resnet50, epoch 2)", "analyzedAt": "…", "source": "model"
}
```

The first four fields are exactly what `genimage_pipeline.py infer` prints. Preprocessing matches `infer`:
EXIF orientation, RGB, square resize to the checkpoint size, ImageNet normalisation.

## What is real and what is not

Real: AI-vs-real score, verdict, threshold, SHA-256, format/size/EXIF metadata.
Not built yet (the UI says so): generator attribution, person and harm detection, source tracing, report submission.
Because harm can't be assessed, auto-report won't fire while "only when high harm" is switched on.

Without the server (opening `frontend/index.html` directly), the frontend runs in demo mode with simulated scores.
