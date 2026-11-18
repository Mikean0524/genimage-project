# GenImage Forensics — frontend (prototype)

Standalone UI for the GenImage project. Plain HTML, CSS and JavaScript: no build step, no dependencies.
## Run it

**With your model** (real scores): from the repository root run `python server/app.py --checkpoint outputs/baseline/best.pt`
and open http://127.0.0.1:8000. See `server/README.md`.

**Demo mode** (simulated scores): open `index.html` directly. The top bar says which mode you are in.

## Screens

| Route | Screen |
|---|---|
| `#scan` | Upload or drop an image → staged examination → verdict, score against threshold, harm assessment, likely generator, signals, SHA-256 |
| `#cases` | Searchable, filterable case list with a detail drawer |
| `#trace` | Where copies were found, the probable origin, and a spread chart |
| `#report` | Four-step Cyber Cell complaint package with validation and a copyable summary |
| `#automation` | Auto-report rule: on/off, score threshold (default 95%), high-harm requirement, time to cancel, reporter contact, recent auto-reports |
| `#model` | Real metrics from `outputs/EXPERIMENT_REPORT.md`, confusion matrix, pipeline status, limitations |

## Files

```
frontend/
  index.html         app shell and navigation
  css/styles.css     all styles (design tokens at the top)
  js/mock-data.js    sample cases, model metrics, trace generator
  js/api.js          MOCK API: the only file to change for integration
  js/app.js          views, routing, interactions
```

## How the frontend talks to the model

All data goes through `window.GI_API` in `js/api.js`. On load, `init()` calls `/api/health`; if the model server answers,
`analyzeImage()` posts the image to `/api/analyze`, otherwise it falls back to the simulated scorer.

`analyzeImage(file)` must return at least the fields `infer` already prints:

```json
{ "image": "...", "ai_score_uncalibrated": 0.94, "assessment": "AI-generated", "threshold": 0.2714381218 }
```

plus `sha256`, `width`, `height`, `format`, `size`, `exif_present`. With the real model, `generators` and
`human_detected` are `null` and `harm.level` is `"unknown"`, and the UI hides or labels those parts. Tracing
(`traceSource`) and reporting (`submitReport`, `autoReport`) are still simulated.

### Auto-report

After each scan, `startAutoJob()` in `js/app.js` checks the rule. If the scan qualifies, it opens a case and starts a
countdown; when the countdown ends it calls `GI_API.autoReport({ caseId, reporter, score, threshold })`. In the real
backend this call should hand the evidence package to whatever channel the Cyber Cell accepts. Settings are kept in
`localStorage` for now and should move to the backend.
