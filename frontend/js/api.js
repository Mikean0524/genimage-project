/* API layer — MOCK implementation.
   Every function returns a Promise with the shape the real backend should return,
   so integration means replacing the bodies below with fetch() calls.

   analyzeImage(file) mirrors `python src/genimage_pipeline.py infer` output:
     { image, ai_score_uncalibrated, assessment, threshold }
   and adds fields the UI needs (hash, metadata, generator, harm). Fields marked
   "planned" are not produced by the current model and are simulated here. */
(function () {
  "use strict";
  const D = window.GI_DATA;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  async function sha256Hex(buffer) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      // Fallback for insecure contexts (file://): FNV-style hash, padded. Not cryptographic.
      const bytes = new Uint8Array(buffer);
      let h = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x1b873593];
      for (let i = 0; i < bytes.length; i++) h[i & 3] = Math.imul(h[i & 3] ^ bytes[i], 16777619) >>> 0;
      return h.map((x) => x.toString(16).padStart(8, "0")).join("").repeat(2);
    }
  }

  function readDimensions(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = url;
    });
  }

  function formatOf(file) {
    const t = (file.type || "").toLowerCase();
    if (t.includes("png")) return "PNG";
    if (t.includes("jpeg") || t.includes("jpg")) return "JPEG";
    if (t.includes("webp")) return "WEBP";
    if (t.includes("gif")) return "GIF";
    if (t.includes("bmp")) return "BMP";
    return (file.name.split(".").pop() || "?").toUpperCase();
  }

  // ---------- live backend (server/app.py) ----------
  const API_BASE = window.GI_API_BASE || "";
  const live = { on: false, health: null };

  async function init() {
    if (location.protocol === "file:") return live;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(API_BASE + "/api/health", { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      const h = res.ok ? await res.json() : null;
      if (h && h.status === "ok") {
        live.on = true;
        live.health = h;
        D.MODEL.threshold = h.threshold;
        D.MODEL.name = h.model;
        if (h.evaluation) {
          D.MODEL.metrics = { ...D.MODEL.metrics, ...h.evaluation, throughput: null };
          D.MODEL.confusion = h.evaluation.confusion;
          D.MODEL.framework = "ONNX Runtime (CPU)";
          D.MODEL.input = "384 × 384 center crop, ImageNet normalization";
          D.MODEL.trainedOn = "Published frontier detector; local check on 1,750 GenImage-derived test images";
          D.MODEL.trainingSummary = "Published model tested locally";
          D.MODEL.limitations = [
            "The local GenImage test set may overlap with the published model's training sources; it is not an independent estimate of performance.",
            "The fixed threshold missed 119 of 875 generated images in this test. A real verdict can still be wrong.",
            "Future generators, heavy editing, cropping, and recompression can change accuracy.",
            "The detector assesses whole images; it cannot reliably identify small generated or edited regions."
          ];
        }
      }
    } catch (e) { /* no backend: stay in demo mode */ }
    return live;
  }

  function buildSignals({ format, exif, width, height, isAI, demo }) {
    const out = [];
    out.push({ level: "ok", text: `<b>${format || "Unknown"}</b> file. File format alone does not establish image origin.` });
    out.push(exif ? { level: "ok", text: "<b>Camera metadata present</b> — still verify, metadata can be copied." }
                  : { level: "warn", text: "<b>No camera metadata</b> (EXIF) found — common for generated or re-shared images." });
    out.push({ level: "ok", text: `<b>${width}×${height}</b> pixels. Dimensions alone do not establish image origin.` });
    if (demo && isAI) out.push({ level: "bad", text: "<b>High-frequency artefacts</b> concentrated around face and hair boundaries." });
    return out;
  }

  async function analyzeLive(file) {
    let res;
    try {
      res = await fetch(API_BASE + "/api/analyze", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-Filename": encodeURIComponent(file.name || "upload") },
        body: file
      });
    } catch (e) {
      throw new Error("Lost connection to the model server. Check that server/app.py is still running.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The model server returned an error (${res.status}).`);
    return {
      ...data,
      imageFile: file,
      url: URL.createObjectURL(file),
      generators: null,                          // not produced by the model yet
      human_detected: null,                      // not produced by the model yet
      harm: { level: "unknown", categories: [] },
      signals: buildSignals({ format: data.format, exif: data.exif_present, width: data.width, height: data.height, isAI: data.assessment === "AI-generated", demo: false }),
      live: true
    };
  }

  /**
   * Run detection on one image.
   * @param {File|Blob} file
   * @param {{hint?: object}} opts  hint lets the sample buttons force an outcome
   */
  async function analyzeImage(file, opts = {}) {
    if (live.on) return analyzeLive(file);
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    const url = URL.createObjectURL(file);
    const dims = await readDimensions(url);
    const r = D.rng(parseInt(sha256.slice(0, 8), 16));
    const format = formatOf(file);
    const hint = opts.hint || {};

    // Simulated classifier score. Lean PNG towards "AI" to mirror the known
    // format shortcut documented in EXPERIMENT_REPORT.md.
    let score = hint.score != null ? hint.score : Math.min(0.995, Math.max(0.01, r() * 0.8 + (format === "PNG" ? 0.25 : 0)));
    const threshold = D.MODEL.threshold;
    const isAI = score >= threshold;

    // Planned: generator attribution (softmax over 7 GenImage generators).
    let raw = D.GENERATORS.map(() => r() + 0.05);
    const topIdx = hint.generator != null ? D.GENERATORS.indexOf(hint.generator) : Math.floor(r() * raw.length);
    raw[topIdx] += 2.2;
    const sum = raw.reduce((a, b) => a + b, 0);
    const generators = D.GENERATORS.map((g, i) => ({ name: g, p: raw[i] / sum })).sort((a, b) => b.p - a.p);

    // Planned: person detection + harm assessment.
    const human = hint.human != null ? hint.human : r() > 0.3;
    let harmLevel = "none";
    let harmCats = [];
    if (isAI && human) {
      harmLevel = hint.harm || (score > 0.8 ? "high" : score > 0.55 ? "medium" : "low");
      if (harmLevel === "high") harmCats = [0, 1, 3];
      else if (harmLevel === "medium") harmCats = [2];
    }

    const signals = buildSignals({ format, exif: format !== "PNG" && hint.exif !== false, width: dims.width, height: dims.height, isAI, demo: true });
    return {
      image: file.name || "upload",
      ai_score_uncalibrated: score,
      assessment: isAI ? "AI-generated" : "real",
      threshold,
      // UI extensions
      sha256, url, format, size: file.size, ...dims,
      generators,             // planned
      human_detected: human,  // planned
      harm: { level: harmLevel, categories: harmCats.map((i) => D.HARM_CATEGORIES[i]) }, // planned
      signals,
      model: D.MODEL.name,
      analyzedAt: new Date().toISOString()
    };
  }

  async function listCases() { await wait(150); return D.CASES.slice(); }
  async function getCase(id) { await wait(80); return D.CASES.find((c) => c.id === id) || null; }

  async function createCase(result, title) {
    await wait(250);
    const n = 149 + D.CASES.filter((c) => c.local).length;
    const c = {
      id: `GIF-2026-${String(n).padStart(4, "0")}`,
      title: title || `Upload: ${result.image}`,
      status: "new",
      score: result.ai_score_uncalibrated,
      harm: result.harm.level,
      generator: result.assessment !== "AI-generated" ? "—" : result.generators ? result.generators[0].name : "Not assessed",
      human: result.human_detected,
      created: new Date().toISOString(),
      sources: 0,
      analyst: "You",
      harmCats: [],
      thumb: result.url,
      imageFile: result.imageFile || null,
      traceMatches: null,
      sha256: result.sha256,
      local: true
    };
    D.CASES.unshift(c);
    return c;
  }

  async function traceSource(caseId) {
    const c = D.CASES.find((x) => x.id === caseId);
    if (!c) throw new Error("Case not found");
    if (!live.on) throw new Error("Start the local model server to search the web for matching images.");
    if (!live.health?.features?.source_tracing) throw new Error("Source tracing needs a SerpApi or Google Cloud Vision API key on the server. See server/README.md.");
    if (!c.imageFile) throw new Error("This sample case has no uploaded image. Upload an image to run a real source search.");
    let response;
    try {
      response = await fetch(API_BASE + "/api/trace", {
        method: "POST", headers: { "Content-Type": c.imageFile.type || "application/octet-stream" }, body: c.imageFile
      });
    } catch (error) {
      throw new Error("Could not reach the local source-tracing server.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Source search failed (${response.status}).`);
    c.traceMatches = result.matches;
    c.sources = result.matches.length;
    return result;
  }

  async function submitReport(payload) {
    await wait(1600);
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const ref = `GIF-RPT-${code}-${Math.floor(1000 + Math.random() * 9000)}`;
    const c = D.CASES.find((x) => x.id === payload.caseId);
    if (c) { c.status = "reported"; c.ref = ref; }
    return { ref, createdAt: new Date().toISOString() };
  }

  /** Automatic submission for scores above the user's auto-report rule. */
  async function autoReport({ caseId, reporter, score, threshold }) {
    const res = await submitReport({ caseId, reporter, auto: true, score, threshold });
    const c = D.CASES.find((x) => x.id === caseId);
    if (c) c.autoReported = true;
    return { ...res, channel: "Cyber Cell (automatic)" };
  }

  async function getModelInfo() { await wait(60); return D.MODEL; }

  window.GI_API = { analyzeImage, listCases, getCase, createCase, traceSource, submitReport, autoReport, getModelInfo, init, live };
})();
