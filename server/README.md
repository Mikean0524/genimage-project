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

`POST /api/trace` accepts raw image bytes. It uses SerpApi's Google Lens exact matches when `SERPAPI_API_KEY` is set, otherwise Google Cloud Vision Web Detection when `GOOGLE_CLOUD_VISION_API_KEY` is set. SerpApi takes priority if both are set. The button is disabled when neither key is set. The uploaded image is sent to the selected provider only when the user clicks **Search web**. Neither provider verifies who first posted an image, so the UI does not claim an original source or upload date.

### Free automated option: SerpApi

[SerpApi's free plan](https://serpapi.com/pricing) currently includes 250 searches per month and does not require Google Cloud billing. Create a SerpApi account, get its API key, then run this in the same PowerShell window used to start the server:

```powershell
$env:SERPAPI_API_KEY = "your-serpapi-key"
python server/app.py
```

The app uploads a JPEG search copy to [SerpApi's Image API](https://serpapi.com/image-api) and searches its [Google Lens exact-match API](https://serpapi.com/google-lens-exact-matches-api). The Image API accepts at most 500 KB, so large images are resized and recompressed for the search. The original case image is not changed. This can miss small details or altered copies. SerpApi says uploaded images may be stored for 30 days for debugging, and an image ID expires after 10 minutes. Searches consume the free monthly allowance; the upload itself does not. Results are indexed matches, not proof of image origin.

### Google Cloud Vision option

Set `GOOGLE_CLOUD_VISION_API_KEY` before starting the server to use full and partial image matching. Images over 7 MB are rejected because Vision limits JSON requests to 10 MB after base64 encoding.

```powershell
$env:GOOGLE_CLOUD_VISION_API_KEY = "your-restricted-key"
python server/app.py
```

Follow [Google's Cloud Vision setup guide](https://docs.cloud.google.com/vision/docs/setup) to create a project, enable billing and the Vision API, and create an API key. Restrict the key to Cloud Vision API. Do not put the key in frontend JavaScript or commit it to Git. Set the variable in the same PowerShell window that runs `python server/app.py`; if the server is already running, stop and restart it after setting the key. Do not include quote characters in the key value itself.

To verify either setup locally, open `http://127.0.0.1:8000/api/health` and check that `features.source_tracing` is `true` and `trace_provider` names the expected provider. This only confirms that a key was supplied; the first actual search confirms whether the provider accepts it. Upload and save an image in the app, open **Source search**, and click **Search web**. Provider errors are shown rather than fabricated matches. The key is never sent to the browser.

Google currently lists the first 1,000 Web Detection requests each month as free and charges beyond that tier; check [Cloud Vision pricing](https://cloud.google.com/vision/pricing) before enabling it. Billing must still be enabled to use this API. A key is never required for the local image detector. Without one, the Source search screen links to manual Google Lens and Bing Visual Search uploads.

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

Real: AI-vs-real score, verdict, threshold, SHA-256, format/size/EXIF metadata, and source matching when SerpApi or Cloud Vision is configured.
Not built yet (the UI says so): generator attribution, person and harm detection, report submission.
Because harm can't be assessed, auto-report won't fire while "only when high harm" is switched on.

Without the server (opening `frontend/index.html` directly), the frontend runs in demo mode with simulated scores.
