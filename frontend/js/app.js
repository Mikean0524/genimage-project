/* GenImage Forensics — UI controller (vanilla JS, no build step). */
(function () {
  "use strict";
  const D = window.GI_DATA;
  const API = window.GI_API;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = $("#view");

  const state = {
    scan: { phase: "idle", file: null, result: null, caseId: null, revealed: false, heat: false },
    casesFilter: "all",
    casesQuery: "",
    traceCaseId: null,
    trace: null,
    traceLoading: false,
    report: freshReport(),
    auto: loadAuto(),
    autoJob: null
  };

  function freshReport() {
    return {
      step: 1, caseId: null, done: null, submitting: false,
      incident: { type: "", noticed: "", description: "", relation: "Self", platforms: [] },
      person: { name: "", phone: "", email: "", state: "", city: "", consentTrue: false, consentShare: false },
      extraFiles: []
    };
  }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
  const fmtDate = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const fmtBytes = (b) => b > 1e6 ? (b / 1e6).toFixed(2) + " MB" : (b / 1e3).toFixed(1) + " KB";
  const harmLabel = { high: "High harm", medium: "Medium harm", low: "Low harm", none: "No harm found", unknown: "Harm not assessed" };
  const ago = (iso) => {
    const h = (Date.now() - new Date(iso).getTime()) / 3600000;
    if (h < 1) return "just now";
    if (h < 24) return Math.round(h) + " h ago";
    return Math.round(h / 24) + " d ago";
  };

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), 3600);
  }

  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label + " copied"); }
    catch (e) { toast("Copy was blocked by the browser. Select the text manually."); }
  }

  const ICON = {
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M12 8v5M12 16h.01"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    trace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8.3 7l7.3.8M7 8.3l2.2 7.4M16.4 10l-4.6 6.2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // ---------- router ----------
  const routes = { scan: renderScan, cases: renderCases, trace: renderTrace, report: renderReport, automation: renderAuto, model: renderModel };

  function route() {
    const name = (location.hash || "#scan").slice(1);
    const fn = routes[name] || renderScan;
    $$(".nav a").forEach((a) => a.setAttribute("aria-current", a.dataset.route === (routes[name] ? name : "scan") ? "page" : "false"));
    closeDrawer(true);
    fn();
    updateCount();
    window.scrollTo(0, 0);
  }
  function go(name) {
    if (location.hash === "#" + name) route(); else location.hash = name;
  }
  function updateCount() {
    const open = D.CASES.filter((c) => c.status !== "closed").length;
    $("#case-count").textContent = open;
  }

  // =====================================================================
  // SCAN
  // =====================================================================
  function renderScan() {
    const s = state.scan;
    if (s.phase === "idle") return renderScanIdle();
    view.innerHTML = `
      <div class="view-head">
        <div>
          <h1>${s.phase === "scanning" ? "Examining image" : "Examination result"}</h1>
          <p>${s.phase === "scanning" ? (API.live.on ? "The image is sent to the local model server for analysis." : "Demo mode uses a simulated score on this device.") : "Review the verdict and signals before taking action. A score is evidence, not proof."}</p>
        </div>
        ${s.phase === "result" ? `<button class="btn" data-act="new-scan">Scan another image</button>` : ""}
      </div>
      <div class="scan-layout">
        <div class="stack">
          ${specimenHTML()}
          ${s.phase === "result" ? fileDetailsHTML(s.result) : ""}
        </div>
        <div class="stack" id="scan-right">
          ${s.phase === "result" ? `<div id="auto-banner">${autoBannerInner(s.result)}</div>` : ""}
          ${s.phase === "scanning" ? stagesHTML() : resultHTML(s.result)}
        </div>
      </div>`;
    bindScan();
  }

  function renderScanIdle() {
    const open = D.CASES.filter((c) => c.status !== "closed");
    const high = D.CASES.filter((c) => c.harm === "high" && c.status !== "closed").length;
    const reported = D.CASES.filter((c) => c.status === "reported").length;
    const m = D.MODEL.metrics;
    view.innerHTML = `
      <div class="home">
        <section class="hero-light" aria-labelledby="hero-title">
          <div class="curve" aria-hidden="true">
            <svg viewBox="0 0 400 240" preserveAspectRatio="none">
              <path d="M-10 90 C 40 30, 70 40, 90 80 S 120 200, 170 175 S 220 100, 260 120 S 320 150, 340 80 L 352 40" fill="none" stroke="#fff" stroke-width="1.8" vector-effect="non-scaling-stroke"/>
              <path d="M338 40 L 353 36 L 356 54" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            </svg>
          </div>
          <span class="hero-dot" style="top:${4 + 42 * 80 / 240}%;left:${90 / 4}%"></span>
          <span class="hero-dot" style="top:${4 + 42 * 120 / 240}%;left:${260 / 4}%"></span>
          <span class="float-pill" style="top:6%;left:27%">AI 94.6%</span>
          <span class="float-pill" style="top:28%;left:69%">Real 8.7%</span>
          <h1 id="hero-title">Detect.<br>Trace.<br>Report.</h1>
          <p>Spot AI-generated deepfakes of real people, find where they spread, and report them to the Cyber Cell.</p>
          <button class="btn btn-primary" data-pick>Examine an image</button>
        </section>

        <div class="home-right">
          <div>
            <label class="dropzone" id="dropzone" tabindex="0">
              <input type="file" id="file-input" accept="image/*" class="sr-only">
              <div>
                <div class="drop-circle">${ICON.upload}</div>
                <h2>Drop an image to examine</h2>
                <p>or click to choose a file. ${API.live.on ? esc(D.MODEL.name) : "A demo classifier"} checks it.</p>
                <div class="formats">JPEG, PNG, WEBP or BMP · up to 20 MB · web search requires a separate click</div>
              </div>
            </label>
            <div class="samples">
              <span>No image to hand? Try a sample</span>
              <button class="btn btn-sm" data-sample="deepfake">Manipulated portrait</button>
              <button class="btn btn-sm" data-sample="camera">Camera photo</button>
              <button class="btn btn-sm" data-sample="landscape">Generated landscape</button>
            </div>
          </div>

          <div>
            <div class="section-title"><h2>Needs attention</h2><a href="#cases">See all</a></div>
            <div class="gcards">${open.filter((c) => c.harm === "high").slice(0, 3).map(caseCard).join("")}</div>
          </div>

          <section class="stats-card" aria-label="Statistics">
            <h3>Statistics</h3>
            <div class="stats-grid">
              <div><span>Open cases</span><b>${open.length}</b></div>
              <div><span>Model accuracy</span><b class="up">${pct(m.accuracy, 1)}</b></div>
              <div><span>High harm, unresolved</span><b class="down">${high}</b></div>
              <div><span>AI images caught</span><b class="up">${pct(m.recall, 1)}</b></div>
              <div><span>Reported to Cyber Cell</span><b>${reported}</b></div>
              <div><span>Real images wrongly flagged</span><b class="down">${pct(m.fpr, 1)}</b></div>
            </div>
          </section>
        </div>
      </div>`;

    const dz = $("#dropzone"), input = $("#file-input");
    input.addEventListener("change", () => input.files[0] && startScan(input.files[0]));
    dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) startScan(f); });
    $("[data-pick]").addEventListener("click", () => input.click());
    $$("[data-sample]").forEach((b) => b.addEventListener("click", () => runSample(b.dataset.sample)));
    $$(".gcard[data-case]").forEach((b) => b.addEventListener("click", () => openDrawer(b.dataset.case)));
  }

  function caseCard(c) {
    return `<button class="gcard" data-case="${c.id}">
      <span class="ico"><img src="${c.thumb}" alt=""></span>
      <span><span class="t">${esc(c.title)}</span><br><span class="s">${c.id} · ${ago(c.created)}</span></span>
      <span class="val">${pct(c.score)} AI</span></button>`;
  }

  const LIVE_STAGES = ["Sending image to the local model server", "Computing SHA-256 and reading metadata", "Running image detector"];
  const stages = () => (API.live.on ? LIVE_STAGES : STAGES);
  const STAGES = [
    "Reading file and computing SHA-256",
    "Checking format and metadata",
    "Running ResNet-50 classifier",
    "Looking for people in the image",
    "Assessing harm indicators"
  ];

  function stagesHTML() {
    return `<section class="panel"><div class="panel-head"><div><h2>Examination in progress</h2><p>Usually under five seconds</p></div></div>
      <div class="panel-pad" style="padding-top:4px;padding-bottom:4px"><ol class="stages">
        ${stages().map((t, i) => `<li data-stage="${i}"><span class="ico"></span><span>${t}</span><span class="t"></span></li>`).join("")}
      </ol></div></section>`;
  }

  function specimenHTML() {
    const s = state.scan;
    const r = s.result;
    const sensitive = r && (r.harm.level === "high" || r.harm.level === "medium" || (r.harm.level === "unknown" && r.assessment === "AI-generated"));
    const blurred = sensitive && !s.revealed;
    const url = r ? r.url : s.previewUrl;
    return `<figure class="specimen" style="margin:0">
      <div class="specimen-img ${blurred ? "blurred" : ""} ${s.heat ? "show-heat" : ""}">
        <img src="${url}" alt="Image under examination">
        <div class="heat" style="background:radial-gradient(circle at 50% 38%, rgba(255,92,122,.9), rgba(52,97,255,.6) 18%, transparent 36%), radial-gradient(circle at 30% 70%, rgba(52,97,255,.6), transparent 22%)"></div>
        ${s.phase === "scanning" ? '<div class="sweep"></div>' : ""}
        <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
        ${blurred ? `<div class="reveal-cover"><div><strong>Sensitive content hidden</strong><p>This image may show a real person in a harmful way. It is blurred to protect them.</p><button class="btn btn-sm" data-act="reveal">${ICON.eye} Show image</button></div></div>` : ""}
      </div>
      <figcaption class="specimen-bar">
        <span class="file">${esc(s.file ? s.file.name : "")}</span>
        ${r ? `<span class="row">
          ${sensitive && s.revealed ? `<button class="btn btn-sm btn-ghost" data-act="hide">Blur again</button>` : ""}
          ${r.assessment === "AI-generated" && !r.live ? `<button class="btn btn-sm ${s.heat ? "" : "btn-ghost"}" data-act="heat" aria-pressed="${s.heat}">Artefact map</button>` : ""}
        </span>` : `<span class="mono">examining…</span>`}
      </figcaption>
    </figure>`;
  }

  function fileDetailsHTML(r) {
    return `<section class="panel file-ev"><div class="panel-head"><h3>File evidence</h3><button class="btn btn-sm btn-ghost" data-act="copy-hash">${ICON.copy} Copy hash</button></div>
      <div class="panel-pad"><dl class="kv">
        <dt>SHA-256</dt><dd class="mono">${r.sha256}</dd>
        <dt>Format</dt><dd>${r.format}</dd>
        <dt>Dimensions</dt><dd>${r.width} × ${r.height} px</dd>
        <dt>Size</dt><dd>${fmtBytes(r.size)}</dd>
        <dt>Examined</dt><dd>${fmtDate(r.analyzedAt)} IST</dd>
        <dt>Model</dt><dd>${esc(r.model)}</dd>
      </dl></div></section>`;
  }

  function bigPct(x) {
    const v = (x * 100).toFixed(1).split(".");
    return `${v[0]}<small>.${v[1]}%</small>`;
  }

  function resultHTML(r) {
    const ai = r.assessment === "AI-generated";
    const t = r.threshold;
    const harm = r.harm.level;
    const diff = r.ai_score_uncalibrated - t;
    const confident = Math.abs(diff) > 0.25;
    const canReport = ai && (harm === "high" || harm === "medium" || harm === "unknown");
    return `
      <section class="verdict ${ai ? "is-ai" : "is-real"}">
        <div class="verdict-band">
          ${r.live ? `<div class="live-note">Scored by your model · ${esc(r.model)} · ${(r.inference_seconds * 1000).toFixed(0)} ms</div>` : `<div class="sim-note">Simulated result — the model server isn't running, so this is a placeholder score. Start server/app.py to use your model.</div>`}
          <div class="verdict-kicker"><span>AI detector score</span>
            <span class="tag tag-blue tag-plain">${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(3)} vs threshold</span></div>
          <div class="verdict-head"><div class="big-num">${bigPct(r.ai_score_uncalibrated)}</div></div>
          <div class="verdict-title">${ai ? "AI-generated" : "Real photograph"}</div>
          <p>${ai
            ? `The classifier scored this image above the threshold used to flag AI-generated content.${r.human_detected === true ? " A person appears in the image." : ""}`
            : "The classifier did not find enough evidence of AI generation. Hand-edited manipulation is not covered by this check."}
            ${confident ? "" : " <b>The score is close to the threshold, so review it manually.</b>"}</p>
        </div>
        <div class="meter">
          <div class="meter-track" role="img" aria-label="Score ${r.ai_score_uncalibrated.toFixed(3)} against threshold ${t.toFixed(3)}">
            <div class="meter-threshold" style="left:${t * 100}%"></div>
            <div class="meter-marker" id="meter-marker" style="left:0%"></div>
          </div>
          <div class="meter-scale"><span>Real</span><span class="meter-threshold-label" style="left:${t * 100}%">threshold ${t.toFixed(3)}</span><span>AI</span></div>
        </div>
        <div class="circ-actions">
          ${ai ? `<button class="circ primary" data-act="trace"><span class="c">${ICON.trace}</span>Trace source</button>` : `<button class="circ" data-act="save-case"><span class="c">${ICON.folder}</span>Save case</button>`}
          ${canReport ? `<button class="circ danger" data-act="report"><span class="c">${ICON.shield}</span>Report</button>` : ""}
          <button class="circ" data-act="copy-hash"><span class="c">${ICON.copy}</span>Copy hash</button>
          <button class="circ" data-act="new-scan"><span class="c">${ICON.plus}</span>New scan</button>
        </div>
        <div class="caveat">On the local test set this model wrongly flagged ${pct(D.MODEL.metrics.fpr, 1)} of real images. A score is a screening signal, not proof of origin.</div>
      </section>

      ${ai && harm === "unknown" ? `<section class="harm medium">
        <span class="h-ico">${ICON.shield}</span>
        <div><h3>Check for harm before reporting</h3>
          <p>The model only decides AI-generated or real. It can't yet tell whether a real person is shown or whether the image is harmful, so a person needs to look before reporting.</p></div>
      </section>` : ""}

      ${ai && harm !== "unknown" ? `<section class="harm ${harm}">
        <span class="h-ico">${harm === "high" || harm === "medium" ? ICON.shield : ICON.check}</span>
        <div>
          <h3>${{ high: "Harmful content involving a real person", medium: "Possible misuse of a real person's likeness", low: "Low risk", none: "No person-related harm found" }[harm]}</h3>
          <p>${{ high: "This looks like a deepfake that could seriously harm the person shown. Preserve the evidence and report it.", medium: "The image may be used to impersonate or mislead. Trace where it is being shared.", low: "A person appears, but no harmful use was detected.", none: "No identifiable person was found in the image." }[harm]}</p>
          ${r.harm.categories.length ? `<div class="chips">${r.harm.categories.map((c) => `<span class="tag tag-${harm}">${esc(c)}</span>`).join("")}</div>` : ""}
        </div>
      </section>` : ""}

      ${ai && r.generators ? `<div>
        <div class="section-title"><h2>Likely generator</h2><span class="muted" style="font-size:13px">of 7 GenImage sources</span></div>
        <div class="gcards">
          ${r.generators.slice(0, 4).map((g) => `<div class="gcard" style="cursor:default"><span class="ico" style="font-weight:700;font-size:15px">${esc(g.name.slice(0, 2))}</span>
            <span><span class="t">${esc(g.name)}</span><br><span class="s">${GEN_INFO[g.name] || ""}</span></span><span class="val">${pct(g.p)}</span></div>`).join("")}
        </div></div>` : ""}

      <section class="panel"><div class="panel-head"><h3>Signals found</h3></div>
        <div class="panel-pad" style="padding-top:0;padding-bottom:12px"><ul class="signals">
          ${r.signals.map((x) => `<li><span class="s-dot ${x.level}"></span><span>${x.text}</span></li>`).join("")}
        </ul></div></section>`;
  }

  const GEN_INFO = { ADM: "Diffusion model", BigGAN: "GAN", GLIDE: "Text-to-image diffusion", Midjourney: "Commercial text-to-image", SD15: "Stable Diffusion 1.5", VQDM: "Vector-quantised diffusion", Wukong: "Chinese text-to-image" };

  function bindScan() {
    const s = state.scan;
    $$("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      if (act === "new-scan") { resetScan(); renderScan(); }
      if (act === "reveal") { s.revealed = true; renderScan(); }
      if (act === "hide") { s.revealed = false; renderScan(); }
      if (act === "heat") { s.heat = !s.heat; renderScan(); }
      if (act === "copy-hash") copyText(s.result.sha256, "SHA-256 hash");
      if (act === "save-case") { await ensureCase(); toast(`Saved as ${s.caseId}`); }
      if (act === "trace") { await ensureCase(); state.traceCaseId = s.caseId; state.trace = null; go("trace"); }
      if (act === "report") { await ensureCase(); startReport(s.caseId); }
    }));
    bindAutoBanner();
    if (s.phase === "result") {
      requestAnimationFrame(() => {
        const m = $("#meter-marker"); if (m) m.style.left = s.result.ai_score_uncalibrated * 100 + "%";
        $$(".bar-fill").forEach((el) => (el.style.width = el.dataset.w + "%"));
      });
    }
  }

  async function ensureCase() {
    const s = state.scan;
    if (s.caseId) return s.caseId;
    const c = await API.createCase(s.result);
    s.caseId = c.id;
    updateCount();
    return c.id;
  }

  function resetScan() {
    state.scan = { phase: "idle", file: null, result: null, caseId: null, revealed: false, heat: false };
  }

  async function startScan(file, hint) {
    if (!file.type.startsWith("image/")) { toast("That file is not an image. Choose a JPEG, PNG, WEBP or BMP."); return; }
    if (file.size > 20e6) { toast("That image is over 20 MB. Choose a smaller file."); return; }
    resetScan();
    const s = state.scan;
    s.file = file;
    s.previewUrl = URL.createObjectURL(file);
    s.phase = "scanning";
    if (location.hash !== "#scan" && location.hash !== "") { history.replaceState(null, "", "#scan"); }
    renderScan();
    const resultP = API.analyzeImage(file, { hint }).then((r) => ({ r }), (e) => ({ e }));
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    for (let i = 0; i < stages().length; i++) {
      const li = $(`[data-stage="${i}"]`);
      if (!li) return; // user navigated away
      li.classList.add("active");
      await new Promise((r) => setTimeout(r, reduce ? 60 : 420 + Math.random() * 380));
      li.classList.remove("active"); li.classList.add("done");
      li.querySelector(".ico").textContent = "✓";
      li.querySelector(".t").textContent = ((performance.now() - t0) / 1000).toFixed(2) + " s";
    }
    const out = await resultP;
    if (out.e) {
      resetScan();
      if ((location.hash || "#scan") === "#scan") renderScan();
      toast(out.e.message || "The image could not be examined.");
      return;
    }
    s.result = out.r;
    s.phase = "result";
    await startAutoJob();
    if ((location.hash || "#scan") === "#scan") renderScan();
  }

  // Build sample images on a canvas so they go through exactly the same path as uploads.
  function runSample(kind) {
    const cfg = {
      deepfake: { w: 512, h: 512, type: "image/png", name: "forwarded_profile_photo.png", hue: 335, person: true, hint: { score: 0.973, generator: "SD15", human: true, harm: "high" } },
      camera: { w: 800, h: 600, type: "image/jpeg", name: "IMG_20261102_174512.jpg", hue: 200, person: true, hint: { score: 0.087, human: true } },
      landscape: { w: 512, h: 512, type: "image/png", name: "wallpaper_valley.png", hue: 30, person: false, hint: { score: 0.812, generator: "Midjourney", human: false } }
    }[kind];
    const c = document.createElement("canvas");
    c.width = cfg.w; c.height = cfg.h;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, cfg.w, cfg.h);
    grad.addColorStop(0, `hsl(${cfg.hue},45%,42%)`); grad.addColorStop(1, `hsl(${(cfg.hue + 60) % 360},50%,18%)`);
    g.fillStyle = grad; g.fillRect(0, 0, cfg.w, cfg.h);
    if (cfg.person) {
      const cx = cfg.w / 2;
      g.fillStyle = `hsl(${cfg.hue},25%,72%)`;
      g.beginPath(); g.ellipse(cx, cfg.h * 0.4, cfg.w * 0.13, cfg.h * 0.17, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(${cfg.hue},20%,60%)`;
      g.beginPath(); g.moveTo(cx - cfg.w * 0.32, cfg.h);
      g.bezierCurveTo(cx - cfg.w * 0.28, cfg.h * 0.7, cx - cfg.w * 0.12, cfg.h * 0.62, cx, cfg.h * 0.62);
      g.bezierCurveTo(cx + cfg.w * 0.12, cfg.h * 0.62, cx + cfg.w * 0.28, cfg.h * 0.7, cx + cfg.w * 0.32, cfg.h); g.fill();
    } else {
      g.fillStyle = "hsla(40,60%,80%,.8)"; g.beginPath(); g.arc(cfg.w * 0.7, cfg.h * 0.3, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = "hsl(220,30%,20%)"; g.beginPath(); g.moveTo(0, cfg.h); g.lineTo(cfg.w * 0.35, cfg.h * 0.45); g.lineTo(cfg.w * 0.6, cfg.h * 0.7); g.lineTo(cfg.w * 0.82, cfg.h * 0.5); g.lineTo(cfg.w, cfg.h); g.fill();
    }
    c.toBlob((blob) => startScan(new File([blob], cfg.name, { type: cfg.type }), cfg.hint), cfg.type, 0.9);
  }

  // =====================================================================
  // CASES
  // =====================================================================
  function renderCases() {
    view.innerHTML = `
      <div class="view-head">
        <div><h1>Cases</h1><p>Every examined image that was saved, with its harm level and where it is in the reporting process.</p></div>
        <a class="btn btn-primary" href="#scan">Scan new image</a>
      </div>
      <section class="panel">
        <div class="toolbar">
          <label class="sr-only" for="q">Search cases</label>
          <input class="input" id="q" type="search" placeholder="Search by title or case ID" value="${esc(state.casesQuery)}">
          <div class="seg" role="group" aria-label="Filter by status">
            ${[["all", "All"], ...Object.entries(D.STATUSES)].map(([k, v]) => `<button data-filter="${k}" aria-pressed="${state.casesFilter === k}">${v}</button>`).join("")}
          </div>
        </div>
        <div class="table-wrap" id="cases-table"></div>
      </section>`;
    drawCasesTable();
    $("#q").addEventListener("input", (e) => { state.casesQuery = e.target.value; drawCasesTable(); });
    $$("[data-filter]").forEach((b) => b.addEventListener("click", () => {
      state.casesFilter = b.dataset.filter;
      $$("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      drawCasesTable();
    }));
  }

  function drawCasesTable() {
    const q = state.casesQuery.trim().toLowerCase();
    const rows = D.CASES.filter((c) => (state.casesFilter === "all" || c.status === state.casesFilter) && (!q || c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)));
    const el = $("#cases-table");
    if (!rows.length) {
      el.innerHTML = `<div class="empty"><h3>No cases match</h3><p>Clear the search or choose another status.</p></div>`;
      return;
    }
    el.innerHTML = `<table>
      <thead><tr><th>Case</th><th>Status</th><th>Harm</th><th>AI score</th><th>Generator</th><th>Sightings</th><th>Analyst</th><th>Opened</th></tr></thead>
      <tbody>${rows.map((c) => `<tr data-case="${c.id}" tabindex="0">
        <td><div class="case-cell"><img class="thumb" src="${c.thumb}" alt=""><div><div class="title">${esc(c.title)}</div><div class="id">${c.id}${c.demo ? " · Sample case" : ""}</div></div></div></td>
        <td><span class="status ${c.status}"><i></i>${D.STATUSES[c.status]}</span>${c.autoReported ? ' <span class="tag tag-blue tag-plain">Auto</span>' : ""}</td>
        <td><span class="tag tag-${c.harm}">${harmLabel[c.harm]}</span></td>
        <td><span class="score-pill" style="color:${c.score >= D.MODEL.threshold ? "#ff5c7a" : "#5ce1c6"}">${c.score.toFixed(2)}</span></td>
        <td>${esc(c.generator)}</td>
        <td class="mono">${c.demo ? "Sample" : c.traceResult ? c.sources : "Not searched"}</td>
        <td>${esc(c.analyst)}</td>
        <td class="muted">${ago(c.created)}</td>
      </tr>`).join("")}</tbody></table>`;
    $$("tr[data-case]", el).forEach((tr) => {
      tr.addEventListener("click", () => openDrawer(tr.dataset.case));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") openDrawer(tr.dataset.case); });
    });
  }

  // ---------- drawer ----------
  let lastFocus = null;
  function openDrawer(id) {
    const c = D.CASES.find((x) => x.id === id);
    if (!c) return;
    closeDrawer(true);
    lastFocus = document.activeElement;
    const bd = document.createElement("div"); bd.className = "drawer-backdrop";
    const dr = document.createElement("aside"); dr.className = "drawer"; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true"); dr.setAttribute("aria-labelledby", "drawer-title");
    const created = new Date(c.created).getTime();
    const log = [
      [created, "Image examined and case opened"],
      ...(c.status !== "new" ? [[created + 3.6e6 * 2, `Assigned to ${c.analyst}`]] : []),
      ...(c.traceResult ? [[created + 3.6e6 * 6, `Source search found ${c.sources} matching links`]] : []),
      ...(c.status === "reported" ? [[created + (c.autoReported ? 6e4 : 3.6e6 * 9), c.autoReported ? `Reported to Cyber Cell automatically · ${c.ref}` : `Complaint package prepared · ${c.ref}`]] : []),
      ...(c.status === "closed" ? [[created + 3.6e6 * 5, c.harm === "none" ? "Closed — image judged authentic" : "Closed — no further action"]] : [])
    ];
    dr.innerHTML = `
      <div class="drawer-head">
        <div><span class="mono muted">${c.id}</span><h2 id="drawer-title">${esc(c.title)}</h2></div>
        <button class="btn btn-ghost btn-sm" data-close aria-label="Close">${ICON.close}</button>
      </div>
      <div class="drawer-body">
        <div class="specimen"><div class="specimen-img blurred" style="aspect-ratio:16/9"><img src="${c.thumb}" alt=""><div class="reveal-cover"><div><strong>Preview blurred</strong><p>Open the full case to view evidence.</p></div></div></div></div>
        <div class="row"><span class="status ${c.status}"><i></i>${D.STATUSES[c.status]}</span><span class="tag tag-${c.harm}">${harmLabel[c.harm]}</span></div>
        <dl class="kv">
          <dt>AI score</dt><dd class="mono">${c.score.toFixed(3)} (threshold ${D.MODEL.threshold.toFixed(3)})</dd>
          <dt>Verdict</dt><dd>${c.score >= D.MODEL.threshold ? "AI-generated" : "Real"}</dd>
          <dt>Likely generator</dt><dd>${esc(c.generator)}</dd>
          <dt>Person shown</dt><dd>${c.human == null ? "Not assessed" : c.human ? "Yes" : "No"}</dd>
          <dt>Matching web links</dt><dd>${c.demo ? "Sample case" : c.traceResult ? c.sources : "Not searched"}</dd>
          <dt>Analyst</dt><dd>${esc(c.analyst)}</dd>
          ${c.ref ? `<dt>Report reference</dt><dd class="mono">${c.ref}</dd>` : ""}
        </dl>
        <div><h3 style="font-family:var(--f-display);font-size:16px;margin:0 0 12px">Activity</h3>
          <ul class="log">${log.map(([t, txt]) => `<li><time>${fmtDate(new Date(Math.min(t, Date.now())).toISOString())}</time>${esc(txt)}</li>`).join("")}</ul></div>
      </div>
      <div class="drawer-foot">
        ${c.imageFile ? `<button class="btn btn-primary" data-d="trace">${ICON.trace} ${c.traceResult ? "View source search" : "Search web"}</button>` : ""}
        ${["high", "medium", "unknown"].includes(c.harm) && c.score >= D.MODEL.threshold ? `<button class="btn ${c.status === "reported" ? "" : "btn-danger"}" data-d="report">${ICON.shield} ${c.status === "reported" ? "View report" : "Report to Cyber Cell"}</button>` : ""}
        ${c.status !== "closed" ? `<button class="btn btn-ghost" data-d="close">Close case</button>` : ""}
      </div>`;
    document.body.append(bd, dr);
    requestAnimationFrame(() => { bd.classList.add("open"); dr.classList.add("open"); });
    bd.addEventListener("click", () => closeDrawer());
    $("[data-close]", dr).addEventListener("click", () => closeDrawer());
    $("[data-close]", dr).focus();
    dr.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
    $$("[data-d]", dr).forEach((b) => b.addEventListener("click", () => {
      const a = b.dataset.d;
      if (a === "trace") { state.traceCaseId = c.id; state.trace = c.traceResult || null; go("trace"); }
      if (a === "report") { startReport(c.id); }
      if (a === "close") { c.status = "closed"; closeDrawer(); toast(`${c.id} closed`); if (location.hash === "#cases") drawCasesTable(); updateCount(); }
    }));
  }
  function closeDrawer(instant) {
    const bd = $(".drawer-backdrop"), dr = $(".drawer");
    if (!dr) return;
    if (instant) { bd.remove(); dr.remove(); return; }
    bd.classList.remove("open"); dr.classList.remove("open");
    setTimeout(() => { bd.remove(); dr.remove(); }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // =====================================================================
  // TRACE
  // =====================================================================
  function renderTrace() {
    const traceable = D.CASES.filter((c) => c.imageFile);
    if (!traceable.some((c) => c.id === state.traceCaseId)) state.traceCaseId = traceable[0]?.id || null;
    const c = traceable.find((item) => item.id === state.traceCaseId);
    const ready = API.live.on && API.live.health?.features?.source_tracing;
    view.innerHTML = `
      <div class="view-head">
        <div><h1>Source search</h1><p>Find indexed pages with copies of an uploaded image. A match is not proof of who posted it first.</p></div>
        ${c ? `<div class="picker"><label class="sr-only" for="trace-case">Case</label>
          <select class="input" id="trace-case">${traceable.map((item) => `<option value="${esc(item.id)}" ${item.id === c.id ? "selected" : ""}>${esc(item.id)} - ${esc(item.title.slice(0, 40))}</option>`).join("")}</select>
          <button class="btn btn-primary" id="run-trace" ${ready ? "" : "disabled"}>Search web</button></div>` : ""}
      </div>
      ${!c ? `<section class="panel"><div class="empty"><h3>No uploaded image yet</h3><p>Scan an image, save its case, then return here to search for copies.</p></div></section>` : `
      ${ready ? `<div class="notice">Clicking Search web sends this image to ${esc(API.live.health.trace_provider)}. Search results cannot verify the original uploader or posting date.</div>` : ""}
      ${!ready ? `<div class="notice">No automatic web search is configured. You can use a free SerpApi key for automatic Google Lens exact-match searches (see server/README.md), or search manually with Google Lens or Bing Visual Search. Open either site and upload the same image file you used for this case. Manual results appear on that site.</div>
      <div class="row" style="gap:10px;flex-wrap:wrap;margin:16px 0">
        <a class="btn btn-primary" href="https://www.google.com/" target="_blank" rel="noopener noreferrer">Open Google Lens</a>
        <a class="btn" href="https://www.bing.com/images" target="_blank" rel="noopener noreferrer">Open Bing Visual Search</a>
      </div>` : ""}
      <div id="trace-body"></div>`}`;
    if (!c) return;
    $("#trace-case").addEventListener("change", (event) => {
      state.traceCaseId = event.target.value;
      state.trace = D.CASES.find((item) => item.id === state.traceCaseId)?.traceResult || null;
      state.traceError = null;
      renderTrace();
    });
    $("#run-trace").addEventListener("click", runTrace);
    drawTraceBody(c);
  }

  function drawTraceBody(c) {
    const el = $("#trace-body");
    if (!el || !c) return;
    if (state.traceLoading) {
      el.innerHTML = `<section class="panel"><div class="empty"><h3>Searching the web...</h3><p>Checking for full and partial image matches.</p></div></section>`;
      return;
    }
    if (state.traceError) {
      el.innerHTML = `<section class="panel"><div class="empty"><h3>Search unavailable</h3><p>${esc(state.traceError)}</p></div></section>`;
      return;
    }
    const result = state.trace || c.traceResult;
    if (!result) {
      el.innerHTML = `<section class="panel"><div class="empty"><h3>No search run for this image</h3><p>${API.live.on && API.live.health?.features?.source_tracing ? "Use Search web above to check for indexed copies." : "Use Google Lens or Bing Visual Search above, then upload this image on their site."}</p></div></section>`;
      return;
    }
    const matches = result.matches || [];
    if (!matches.length) {
      el.innerHTML = `<section class="panel"><div class="empty"><h3>No matching pages found</h3><p>${esc(result.provider)} found no indexed matches. This does not prove the image has never been posted.</p></div></section>`;
      return;
    }
    el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>${matches.length} matching results</h2>
      <p>${esc(result.provider)} - searched ${fmtDate(result.searched_at)} IST</p></div>
      <button class="btn btn-sm" id="copy-links">${ICON.copy} Copy links</button></div>
      <ol class="timeline">${matches.map((match, index) => `<li><span class="n">${index + 1}</span>
        <div><div class="where">${esc(match.title || new URL(match.url).hostname)}
          <span class="tag tag-blue tag-plain">${match.kind === "exact" ? "Lens exact match" : match.kind === "full" ? "Full match" : "Partial match"}</span></div>
          <div class="url"><a href="${esc(match.url)}" target="_blank" rel="noopener noreferrer">${esc(match.url)}</a></div></div></li>`).join("")}</ol>
      <div class="panel-pad"><p class="muted">Results have no verified upload date, view count, or original-source ranking.</p></div></section>`;
    $("#copy-links").addEventListener("click", () => copyText(matches.map((match) => match.url).join("\n"), "Match links"));
  }

  async function runTrace() {
    const id = state.traceCaseId;
    if (!id || state.traceLoading) return;
    state.traceLoading = true;
    state.traceError = null;
    renderTrace();
    try {
      const result = await API.traceSource(id);
      if (state.traceCaseId !== id) return;
      const c = D.CASES.find((item) => item.id === id);
      c.traceResult = result;
      c.sources = result.matches.length;
      if (c.sources && ["new", "review"].includes(c.status)) c.status = "traced";
      state.trace = result;
      toast(`Found ${result.matches.length} matching results`);
    } catch (error) {
      if (state.traceCaseId === id) state.traceError = error.message || "Source search failed.";
    } finally {
      state.traceLoading = false;
      if (location.hash === "#trace") renderTrace();
    }
  }

  // =====================================================================
  // REPORT
  // =====================================================================
  function startReport(caseId) {
    state.report = freshReport();
    state.report.caseId = caseId;
    const c = D.CASES.find((x) => x.id === caseId);
    if (c && c.status === "reported") state.report.done = { ref: c.ref, createdAt: c.created };
    go("report");
  }

  const STEP_NAMES = ["Incident", "Your details", "Evidence", "Review & submit"];

  function renderReport() {
    const R = state.report;
    const reportable = D.CASES.filter((c) => c.harm === "high" || c.harm === "medium" || c.local);
    if (!R.caseId) R.caseId = (reportable.find((c) => c.status !== "reported") || reportable[0] || {}).id;
    const c = D.CASES.find((x) => x.id === R.caseId);

    if (R.done) return renderReportDone(c);

    view.innerHTML = `
      <div class="view-head">
        <div><h1>Report to Cyber Cell</h1><p>Build a complete complaint package. You will get a reference number and instructions to file it on the National Cyber Crime Reporting Portal or by calling 1930.</p><div class="sim-note" style="margin:12px 0 0;display:inline-block">Simulated — nothing is sent to the Cyber Cell yet.</div></div>
        <div class="picker"><label class="sr-only" for="report-case">Case</label>
          <select class="input" id="report-case">${reportable.map((x) => `<option value="${x.id}" ${x.id === R.caseId ? "selected" : ""}>${x.id} — ${esc(x.title.slice(0, 40))}${x.title.length > 40 ? "…" : ""}</option>`).join("")}</select></div>
      </div>
      <ol class="steps">${STEP_NAMES.map((n, i) => `<li class="${i + 1 === R.step ? "current" : i + 1 < R.step ? "done" : ""}" ${i + 1 === R.step ? 'aria-current="step"' : ""}><span class="num">${i + 1 < R.step ? "✓" : i + 1}</span><span class="label">${n}</span></li>`).join("")}</ol>
      <div class="report-layout">
        <form class="panel" id="report-form" novalidate>
          <div class="form-body">${reportStepHTML(R, c)}</div>
          <div class="form-foot">
            ${R.step > 1 ? `<button type="button" class="btn" id="back">Back</button>` : "<span></span>"}
            ${R.step < 4 ? `<button type="submit" class="btn btn-primary">Continue</button>` : `<button type="submit" class="btn btn-danger" ${R.submitting ? "disabled" : ""}>${R.submitting ? "Preparing package…" : "Submit report"}</button>`}
          </div>
        </form>
        <aside class="stack">
          <section class="panel">
            <div class="specimen" style="border:0;border-radius:8px 8px 0 0"><div class="specimen-img blurred" style="aspect-ratio:16/10"><img src="${c.thumb}" alt=""></div></div>
            <div class="panel-pad"><div class="mono muted">${c.id}</div><h3 style="margin:4px 0 10px">${esc(c.title)}</h3>
              <div class="row"><span class="tag tag-${c.harm}">${harmLabel[c.harm]}</span><span class="tag tag-plain">AI score ${c.score.toFixed(2)}</span></div></div>
          </section>
          <div class="notice"><strong>In an emergency</strong>, or if someone is being threatened or extorted right now, call the national cybercrime helpline <strong>1930</strong> or police <strong>112</strong> before finishing this form.</div>
          <div class="notice">Do not delete the original messages or posts. Investigators may need them alongside this package.</div>
        </aside>
      </div>`;

    $("#report-case").addEventListener("change", (e) => { startReport(e.target.value); });
    $("#back") && $("#back").addEventListener("click", () => { collectStep(); R.step--; renderReport(); });
    $("#report-form").addEventListener("submit", onReportSubmit);
    bindReportStep(R);
  }

  function reportStepHTML(R, c) {
    const I = R.incident, P = R.person;
    const trace = c.traceMatches || [];
    if (R.step === 1) return `
      <h2>What happened?</h2>
      <div class="field" data-f="type"><label for="f-type">Type of incident</label>
        <select class="input" id="f-type"><option value="">Choose one</option>${D.INCIDENT_TYPES.map((t) => `<option ${I.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        <span class="error">Choose the type of incident.</span></div>
      <div class="grid-2">
        <div class="field" data-f="noticed"><label for="f-noticed">When did you first see it?</label>
          <input class="input" type="date" id="f-noticed" max="2026-11-18" value="${esc(I.noticed)}"><span class="error">Enter the date you first saw the image.</span></div>
        <div class="field"><span class="label">Who is shown in the image?</span>
          <select class="input" id="f-relation">${["Self", "Someone I know (with their consent)", "A minor in my care", "A public figure", "Someone I don't know"].map((x) => `<option ${I.relation === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div>
      <div class="field" data-f="description"><label for="f-desc">Describe what happened</label>
        <textarea class="input" id="f-desc" maxlength="2000" placeholder="Where you saw the image, who shared it, any messages or demands that came with it.">${esc(I.description)}</textarea>
        <span class="hint"><span id="desc-count">${I.description.length}</span> / 2000 characters. At least 30.</span>
        <span class="error">Add a few more details — at least 30 characters.</span></div>
      ${trace.length ? `<div class="field"><span class="label">Matching web pages <span class="muted">(original source unverified)</span></span>
        <div class="stack" style="gap:8px">${trace.slice(0, 6).map((s) => `<label class="check"><input type="checkbox" name="plat" value="${esc(s.url)}" ${I.platforms.length === 0 || I.platforms.includes(s.url) ? "checked" : ""}><span>${esc(s.title || new URL(s.url).hostname)} <span class="mono muted">${esc(s.url)}</span></span></label>`).join("")}</div></div>` : ""}`;

    if (R.step === 2) return `
      <h2>Your contact details</h2>
      <p class="muted" style="margin:-8px 0 0">The Cyber Cell uses these to contact you about the complaint. They are not shared with the platforms.</p>
      <div class="field" data-f="name"><label for="f-name">Full name</label><input class="input" id="f-name" autocomplete="name" value="${esc(P.name)}"><span class="error">Enter your full name.</span></div>
      <div class="grid-2">
        <div class="field" data-f="phone"><label for="f-phone">Mobile number</label><input class="input" id="f-phone" inputmode="numeric" autocomplete="tel" placeholder="10-digit number" value="${esc(P.phone)}"><span class="error">Enter a 10-digit Indian mobile number.</span></div>
        <div class="field" data-f="email"><label for="f-email">Email</label><input class="input" id="f-email" type="email" autocomplete="email" value="${esc(P.email)}"><span class="error">Enter a valid email address.</span></div>
      </div>
      <div class="grid-2">
        <div class="field" data-f="state"><label for="f-state">State or UT</label><select class="input" id="f-state"><option value="">Choose one</option>${D.INDIAN_STATES.map((s) => `<option ${P.state === s ? "selected" : ""}>${s}</option>`).join("")}</select><span class="error">Choose your state or union territory.</span></div>
        <div class="field"><label for="f-city">City or district</label><input class="input" id="f-city" value="${esc(P.city)}"></div>
      </div>`;

    if (R.step === 3) {
      const scan = state.scan.caseId === c.id ? state.scan.result : null;
      const sel = I.platforms.length ? trace.filter((s) => I.platforms.includes(s.url)) : trace.slice(0, 6);
      return `
      <h2>Evidence package</h2>
      <p class="muted" style="margin:-8px 0 0">These items are attached automatically. Hashes let investigators prove the file was not changed after you reported it.</p>
      <ul class="evidence-list">
        <li><div>Original image<div class="sub mono">SHA-256 ${scan ? scan.sha256 : (c.sha256 || fakeHash(c.id))}</div></div><span class="tag tag-ok">Attached</span></li>
        <li><div>Detection result<div class="sub">AI score ${c.score.toFixed(3)} · threshold ${D.MODEL.threshold.toFixed(3)} · ${esc(D.MODEL.name)}</div></div><span class="tag tag-ok">Attached</span></li>
        <li><div>Source search<div class="sub">${sel.length} matching link${sel.length === 1 ? "" : "s"}</div></div><span class="tag ${sel.length ? "tag-ok" : "tag-plain"}">${sel.length ? "Attached" : "None"}</span></li>
        ${R.extraFiles.map((f, i) => `<li><div>${esc(f.name)}<div class="sub">${fmtBytes(f.size)} · added by you</div></div><button type="button" class="btn btn-sm btn-ghost" data-rm="${i}">Remove</button></li>`).join("")}
      </ul>
      <div class="field"><label for="f-extra">Add screenshots of chats, posts or demands</label>
        <input class="input" type="file" id="f-extra" accept="image/*,.pdf" multiple>
        <span class="hint">Screenshots that show the sender's name, number or profile link are the most useful.</span></div>`;
    }

    // step 4
    return `
      <h2>Review before submitting</h2>
      <div class="review-block"><h3>Incident <button type="button" class="btn btn-sm btn-ghost" data-edit="1">Edit</button></h3>
        <dl class="kv"><dt>Type</dt><dd>${esc(I.type)}</dd><dt>First seen</dt><dd>${esc(I.noticed)}</dd><dt>Person shown</dt><dd>${esc(I.relation)}</dd><dt>Description</dt><dd>${esc(I.description)}</dd><dt>Platforms</dt><dd>${(I.platforms.length || trace.length) ? (I.platforms.length || Math.min(6, trace.length)) + " links" : "None"}</dd></dl></div>
      <div class="review-block"><h3>Your details <button type="button" class="btn btn-sm btn-ghost" data-edit="2">Edit</button></h3>
        <dl class="kv"><dt>Name</dt><dd>${esc(P.name)}</dd><dt>Mobile</dt><dd>${esc(P.phone)}</dd><dt>Email</dt><dd>${esc(P.email)}</dd><dt>Location</dt><dd>${esc([P.city, P.state].filter(Boolean).join(", "))}</dd></dl></div>
      <div class="review-block"><h3>Evidence <button type="button" class="btn btn-sm btn-ghost" data-edit="3">Edit</button></h3>
        <dl class="kv"><dt>Items</dt><dd>Original image, detection result${trace.length ? ", source search matches" : ""}${R.extraFiles.length ? `, ${R.extraFiles.length} file${R.extraFiles.length > 1 ? "s" : ""} from you` : ""}</dd></dl></div>
      <div class="field" data-f="consentTrue"><label class="check"><input type="checkbox" id="f-c1" ${P.consentTrue ? "checked" : ""}><span>The information I have given is true to the best of my knowledge.</span></label><span class="error">Confirm the information is true to continue.</span></div>
      <div class="field" data-f="consentShare"><label class="check"><input type="checkbox" id="f-c2" ${P.consentShare ? "checked" : ""}><span>I agree to share this evidence package with law enforcement for investigation.</span></label><span class="error">Consent is needed to share the evidence.</span></div>`;
  }

  function fakeHash(id) {
    let h = "";
    const r = D.rng(parseInt(id.replace(/\D/g, ""), 10) * 131);
    for (let i = 0; i < 64; i++) h += Math.floor(r() * 16).toString(16);
    return h;
  }

  function bindReportStep(R) {
    const desc = $("#f-desc");
    if (desc) desc.addEventListener("input", () => ($("#desc-count").textContent = desc.value.length));
    const extra = $("#f-extra");
    if (extra) extra.addEventListener("change", () => { R.extraFiles.push(...Array.from(extra.files).map((f) => ({ name: f.name, size: f.size }))); renderReport(); });
    $$("[data-rm]").forEach((b) => b.addEventListener("click", () => { R.extraFiles.splice(+b.dataset.rm, 1); renderReport(); }));
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => { collectStep(); R.step = +b.dataset.edit; renderReport(); }));
    const first = $("#report-form .input, #report-form input");
    if (first && R.step > 1) first.focus({ preventScroll: true });
  }

  function collectStep() {
    const R = state.report, I = R.incident, P = R.person;
    if (R.step === 1) {
      I.type = $("#f-type").value; I.noticed = $("#f-noticed").value; I.relation = $("#f-relation").value; I.description = $("#f-desc").value.trim();
      const boxes = $$('input[name="plat"]');
      if (boxes.length) I.platforms = boxes.filter((b) => b.checked).map((b) => b.value);
    }
    if (R.step === 2) { P.name = $("#f-name").value.trim(); P.phone = $("#f-phone").value.replace(/\D/g, ""); P.email = $("#f-email").value.trim(); P.state = $("#f-state").value; P.city = $("#f-city").value.trim(); }
    if (R.step === 4) { P.consentTrue = $("#f-c1").checked; P.consentShare = $("#f-c2").checked; }
  }

  function validateStep() {
    const R = state.report, I = R.incident, P = R.person;
    const bad = [];
    if (R.step === 1) {
      if (!I.type) bad.push("type");
      if (!I.noticed) bad.push("noticed");
      if (I.description.length < 30) bad.push("description");
    }
    if (R.step === 2) {
      if (P.name.length < 2) bad.push("name");
      if (!/^[6-9]\d{9}$/.test(P.phone.slice(-10)) || P.phone.length < 10) bad.push("phone");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(P.email)) bad.push("email");
      if (!P.state) bad.push("state");
    }
    if (R.step === 4) { if (!P.consentTrue) bad.push("consentTrue"); if (!P.consentShare) bad.push("consentShare"); }
    $$(".field[data-f]").forEach((f) => f.classList.toggle("invalid", bad.includes(f.dataset.f)));
    if (bad.length) { const f = $(`.field[data-f="${bad[0]}"] input, .field[data-f="${bad[0]}"] select, .field[data-f="${bad[0]}"] textarea`); f && f.focus(); }
    return !bad.length;
  }

  async function onReportSubmit(e) {
    e.preventDefault();
    const R = state.report;
    collectStep();
    if (!validateStep()) return;
    if (R.step < 4) { R.step++; renderReport(); return; }
    R.submitting = true; renderReport();
    const res = await API.submitReport({ caseId: R.caseId, incident: R.incident, person: R.person, extraFiles: R.extraFiles });
    R.submitting = false;
    R.done = res;
    updateCount();
    if (location.hash === "#report") renderReport();
  }

  function renderReportDone(c) {
    const R = state.report;
    const I = R.incident, P = R.person;
    const trace = c.traceMatches || [];
    const summary = [
      `Complaint reference: ${R.done.ref}`,
      `Case: ${c.id} — ${c.title}`,
      I.type ? `Incident type: ${I.type}` : "",
      I.noticed ? `First seen: ${I.noticed}` : "",
      `Detection: AI score ${c.score.toFixed(3)} (threshold ${D.MODEL.threshold.toFixed(3)}, ${D.MODEL.name})`,
      `Image SHA-256: ${c.sha256 || (state.scan.caseId === c.id && state.scan.result ? state.scan.result.sha256 : fakeHash(c.id))}`,
      I.description ? `Description: ${I.description}` : "",
      trace.length ? "Matching web links (original source unverified):\n" + trace.map((s) => `  - ${s.url} (${s.kind} match)`).join("\n") : "",
      P.name ? `Complainant: ${P.name}, ${P.phone}, ${P.email}, ${[P.city, P.state].filter(Boolean).join(", ")}` : ""
    ].filter(Boolean).join("\n");
    view.innerHTML = `
      <section class="panel success">
        <div class="shield"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#3461ff" stroke-width="2" stroke-linecap="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg></div>
        <h2>Complaint package ready</h2>
        <p>Your evidence for ${c.id} has been assembled and logged. Keep this reference number — you will need it when you file and follow up.</p>
        <div class="ref">${R.done.ref}</div>
        <div class="muted" style="font-size:13px">Prepared ${fmtDate(R.done.createdAt)} IST</div>
        <ol>
          <li>File the complaint on the National Cyber Crime Reporting Portal at <a href="https://cybercrime.gov.in" target="_blank" rel="noopener">cybercrime.gov.in</a> and paste the summary below into the description.</li>
          <li>If money was demanded or lost, call <strong>1930</strong> as soon as possible.</li>
          <li>Ask each platform to remove the posts using its reporting tools. Keep screenshots of what you report.</li>
        </ol>
        <div class="row" style="justify-content:center">
          <button class="btn btn-primary" id="copy-summary">${ICON.copy} Copy complaint summary</button>
          <a class="btn" href="#cases">Back to cases</a>
        </div>
      </section>`;
    $("#copy-summary").addEventListener("click", () => copyText(summary, "Complaint summary"));
  }

  // =====================================================================
  // MODEL
  // =====================================================================
  function renderModel() {
    const M = D.MODEL, m = M.metrics, cm = M.confusion;
    view.innerHTML = `
      <div class="view-head">
        <div><h1>Model &amp; accuracy</h1><p>Local results on 1,750 labeled images. Read the limitations before relying on any verdict.</p></div>
      </div>
      <div class="stack">
        <div class="model-hero">
          <section class="verdict is-real">
            <div class="verdict-band" style="padding-bottom:24px">
              <div class="verdict-kicker"><span>Test accuracy</span><span class="tag tag-blue tag-plain">ROC-AUC ${m.rocAuc.toFixed(3)}</span></div>
              <div class="verdict-head"><div class="big-num">${bigPct(m.accuracy)}</div></div>
              <div class="verdict-title" style="color:#fff">${esc(M.name)}</div>
              <p>${esc(M.framework)} · input ${esc(M.input)} · ${esc(M.trainingSummary || "2 training epochs on CPU")}</p>
            </div>
          </section>
          <section class="stats-card">
            <h3>Statistics</h3>
            <div class="stats-grid">
              <div><span>AI caught (recall)</span><b class="up">${pct(m.recall, 1)}</b></div>
              <div><span>Precision</span><b>${pct(m.precision, 1)}</b></div>
              <div><span>Real wrongly flagged</span><b class="down">${pct(m.fpr, 1)}</b></div>
              <div><span>AI missed</span><b class="down">${pct(m.fnr, 1)}</b></div>
              <div><span>F1 score</span><b>${m.f1.toFixed(3)}</b></div>
              <div><span>Average precision</span><b>${m.ap.toFixed(3)}</b></div>
              <div><span>Threshold</span><b>${M.threshold.toFixed(4)}</b></div>
              <div><span>Throughput</span><b>${m.throughput == null ? "Not measured" : `${m.throughput.toFixed(0)} img/s`}</b></div>
            </div>
          </section>
        </div>
        <div class="grid-2">
          <section class="panel"><div class="panel-head"><div><h3>Test results</h3><p>Rows are the truth, columns are the prediction</p></div></div>
            <div class="panel-pad" style="padding-top:6px"><div class="cm">
              <span></span><span class="h">Predicted real</span><span class="h">Predicted AI</span>
              <span class="h">Real</span><div class="cell ok"><b>${cm.tn}</b>correctly cleared</div><div class="cell bad"><b>${cm.fp}</b>falsely accused</div>
              <span class="h">AI</span><div class="cell bad"><b>${cm.fn}</b>missed</div><div class="cell ok"><b>${cm.tp}</b>correctly caught</div>
            </div></div></section>
          <section class="panel"><div class="panel-head"><div><h3>Pipeline status</h3><p>What this frontend shows versus what the backend produces today</p></div></div>
            <ul class="pipeline-list">
              <li>AI-generated vs real classification <span class="tag tag-ok">Trained</span></li>
              <li>SHA-256 evidence hashing <span class="tag tag-ok">In pipeline</span></li>
              <li>Generator attribution (7 sources) <span class="tag tag-medium">Planned</span></li>
              <li>Person detection &amp; harm assessment <span class="tag tag-medium">Planned</span></li>
              <li>Online source matching <span class="tag ${API.live.health?.features?.source_tracing ? "tag-ok" : "tag-medium"}">${API.live.health?.features?.source_tracing ? "Available" : "Needs API key"}</span></li>
              <li>Cyber Cell report packaging <span class="tag tag-medium">Planned</span></li>
            </ul></section>
        </div>
        <section class="panel"><div class="panel-head"><h3>Known limitations</h3></div>
          <ul class="limits">${(M.limitations || [
            "The training sample has JPEG real images and PNG generated images, creating a format shortcut.",
            "This model can flag real images and miss generated images. Review each verdict manually.",
            "Generalization to newer generators and edited images is unknown."
          ]).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>
      </div>`;
  }
  // =====================================================================
  // AUTO-REPORT
  // =====================================================================
  const AUTO_KEY = "gi-auto-report-v1";
  function loadAuto() {
    const d = {
      enabled: true, threshold: 0.95, requireHarm: true, delay: 30,
      // Sample duty contact so the demo works out of the box.
      reporter: { name: "Duty analyst", org: "GenImage Forensics desk", phone: "9876543210", email: "analyst@genimage.example", state: "Punjab" },
      log: []
    };
    try {
      const v = JSON.parse(localStorage.getItem(AUTO_KEY));
      if (v) return { ...d, ...v, reporter: { ...d.reporter, ...(v.reporter || {}) }, log: v.log || [] };
    } catch (e) { /* storage unavailable */ }
    return d;
  }
  function saveAuto() { try { localStorage.setItem(AUTO_KEY, JSON.stringify(state.auto)); } catch (e) { /* ignore */ } }
  function reporterReady(r = state.auto.reporter) {
    return r.name.trim().length > 1 && /^[6-9]\d{9}$/.test(r.phone) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) && !!r.state;
  }
  const delayLabel = (s) => (s >= 60 ? s / 60 + " min" : s + " s");

  function autoEligibility(r) {
    const A = state.auto;
    if (!A.enabled) return "off";
    if (r.assessment !== "AI-generated" || r.ai_score_uncalibrated < A.threshold) return "below";
    if (A.requireHarm && r.harm.level === "unknown") return "harm-unknown";
    if (A.requireHarm && r.harm.level !== "high") return "harm";
    if (!reporterReady()) return "reporter";
    return "ok";
  }

  async function startAutoJob() {
    const r = state.scan.result;
    const why = autoEligibility(r);
    if (why !== "ok") { state.autoJob = why === "reporter" ? { phase: "blocked", scan: r.sha256 } : null; return; }
    const caseId = await ensureCase();
    const job = { caseId, scan: r.sha256, phase: "countdown", total: state.auto.delay, left: state.auto.delay, score: r.ai_score_uncalibrated };
    state.autoJob = job;
    job.timer = setInterval(() => {
      job.left -= 1;
      if (job.left <= 0) sendAuto(job); else paintAutoBanner();
    }, 1000);
  }

  function cancelAuto(job) {
    if (job.phase !== "countdown") return;
    clearInterval(job.timer);
    job.phase = "cancelled";
    logAuto(job, "cancelled");
    paintAutoBanner();
    toast("Auto-report cancelled");
  }

  async function sendAuto(job) {
    if (job.phase !== "countdown") return;
    clearInterval(job.timer);
    job.phase = "sending";
    paintAutoBanner();
    const res = await API.autoReport({ caseId: job.caseId, reporter: state.auto.reporter, score: job.score, threshold: state.auto.threshold });
    job.phase = "sent";
    job.ref = res.ref;
    logAuto(job, "sent");
    updateCount();
    paintAutoBanner();
    toast(`${job.caseId} reported to Cyber Cell automatically`);
    if (location.hash === "#automation") renderAuto();
  }

  function logAuto(job, status) {
    state.auto.log.unshift({ caseId: job.caseId, score: job.score, status, ref: job.ref || null, at: new Date().toISOString() });
    state.auto.log = state.auto.log.slice(0, 30);
    saveAuto();
  }

  function autoBannerInner(r) {
    const A = state.auto, job = state.autoJob;
    const mine = job && job.scan === r.sha256 ? job : null;
    const thr = pct(A.threshold, 1);
    if (mine && mine.phase === "countdown") {
      const C = 2 * Math.PI * 26, off = C * (1 - mine.left / mine.total);
      return `<div class="auto-banner live" role="status">
        <div class="ring"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" stroke="rgba(255,255,255,.2)"/><circle cx="30" cy="30" r="26" stroke="#fff" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 30 30)"/></svg><b>${mine.left}</b></div>
        <div class="ab-text"><h3>Auto-reporting to Cyber Cell in ${mine.left} s</h3>
          <p>Score ${pct(mine.score, 1)} is at or above your ${thr} rule${A.requireHarm ? " and shows high harm to a real person" : ""}. The evidence package will be sent automatically.</p>
          <div class="row"><button class="btn btn-white btn-sm" data-auto="cancel">Cancel auto-report</button><button class="btn btn-sm" data-auto="now">Send now</button><button class="btn btn-ghost btn-sm" data-auto="review">Review package</button></div></div></div>`;
    }
    if (mine && mine.phase === "sending") {
      return `<div class="auto-banner live" role="status"><div class="ring spin"></div><div class="ab-text"><h3>Sending to Cyber Cell…</h3><p>Packaging the image hash, detection result and source links.</p></div></div>`;
    }
    if (mine && mine.phase === "sent") {
      return `<div class="auto-banner sent" role="status"><div class="ring ok">${ICON.check}</div><div class="ab-text"><h3>Reported automatically</h3>
        <p>Complaint <span class="mono">${mine.ref}</span> was sent for ${mine.caseId}. An analyst should still review it.</p>
        <div class="row"><button class="btn btn-sm" data-auto="case">Open case</button></div></div></div>`;
    }
    if (mine && mine.phase === "cancelled") {
      return `<div class="auto-banner muted-b"><div class="ab-text"><h3>Auto-report cancelled</h3><p>Nothing was sent. You can still report this case manually.</p></div></div>`;
    }
    if (mine && mine.phase === "blocked") {
      return `<div class="auto-banner muted-b"><div class="ab-text"><h3>This image qualifies for auto-report</h3><p>It wasn't sent because the reporter contact details are incomplete.</p>
        <div class="row"><button class="btn btn-primary btn-sm" data-auto="setup">Set up auto-report</button></div></div></div>`;
    }
    if (A.enabled && r.assessment === "AI-generated") {
      const why = autoEligibility(r);
      const msg = why === "below" ? `below the ${thr} auto-report rule, so it needs a manual decision`
        : why === "harm" ? "above the threshold, but auto-report only fires for high harm to a real person"
        : why === "harm-unknown" ? "above the threshold, but the model can't assess harm yet, so it needs a manual decision (or turn off the high-harm requirement in Auto-report)" : "";
      return msg ? `<div class="auto-chip">Auto-report on · this score is ${msg}.</div>` : "";
    }
    return "";
  }

  function paintAutoBanner() {
    const el = $("#auto-banner");
    if (el && state.scan.result) el.innerHTML = autoBannerInner(state.scan.result);
  }

  function bindAutoBanner() {
    const el = $("#auto-banner");
    if (!el) return;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-auto]");
      if (!b) return;
      const job = state.autoJob;
      const a = b.dataset.auto;
      if (a === "cancel" && job) cancelAuto(job);
      if (a === "now" && job) sendAuto(job);
      if (a === "review" && job) startReport(job.caseId);
      if (a === "setup") go("automation");
      if (a === "case" && job) { go("cases"); setTimeout(() => openDrawer(job.caseId), 50); }
    });
  }

  function renderAuto() {
    const A = state.auto, R = A.reporter;
    const DELAYS = [10, 30, 60, 300];
    view.innerHTML = `
      <div class="view-head">
        <div><h1>Auto-report</h1><p>Send high-confidence deepfakes of real people to the Cyber Cell without waiting for an analyst. Each one waits a short time first, so a person can stop a false alarm.</p></div>
      </div>
      <div class="report-layout">
        <form class="panel" id="auto-form" novalidate>
          <div class="form-body">
            <label class="switch-row">
              <span><b>${A.enabled ? "Auto-report is on" : "Auto-report is off"}</b><br><span class="muted">${A.enabled ? "Qualifying scans are reported automatically." : "Every report needs a person to submit it."}</span></span>
              <input type="checkbox" class="switch" id="a-enabled" ${A.enabled ? "checked" : ""} aria-label="Turn auto-report on or off">
            </label>

            <div class="field">
              <span class="label">Report automatically when the AI score is at least</span>
              <div class="thr"><div class="big-num" id="thr-out">${(() => { const v = (A.threshold * 100).toFixed(1).split("."); return `${v[0]}<small>.${v[1]}%</small>`; })()}</div></div>
              <input type="range" class="range" id="a-thr" min="80" max="99.5" step="0.5" value="${(A.threshold * 100).toFixed(1)}" aria-label="Auto-report threshold">
              <div class="range-scale"><span>80%</span><span>Model's flag threshold is ${pct(D.MODEL.threshold, 1)}</span><span>99.5%</span></div>
              <span class="hint">A score of ${pct(A.threshold, 0)} does not mean the model is ${pct(A.threshold, 0)} certain. Higher thresholds send fewer false reports.</span>
            </div>

            <label class="check"><input type="checkbox" id="a-harm" ${A.requireHarm ? "checked" : ""}><span>Only when the image shows a real person with <b>high harm</b> (sexualised, face-swapped or used to threaten)</span></label>

            <div class="field"><span class="label">Time to cancel before it is sent</span>
              <div class="pills" role="group" aria-label="Review window">${DELAYS.map((d) => `<button type="button" data-delay="${d}" aria-pressed="${A.delay === d}">${delayLabel(d)}</button>`).join("")}</div></div>

            <h2 style="margin-top:6px">Reporter contact</h2>
            <p class="muted" style="margin:-12px 0 0">Every complaint needs a named contact. These details go on each auto-report.</p>
            <div class="grid-2">
              <div class="field" data-f="name"><label for="a-name">Full name</label><input class="input" id="a-name" value="${esc(R.name)}"><span class="error">Enter a name.</span></div>
              <div class="field"><label for="a-org">Organisation</label><input class="input" id="a-org" value="${esc(R.org)}"></div>
            </div>
            <div class="grid-2">
              <div class="field" data-f="phone"><label for="a-phone">Mobile number</label><input class="input" id="a-phone" inputmode="numeric" value="${esc(R.phone)}"><span class="error">Enter a 10-digit Indian mobile number.</span></div>
              <div class="field" data-f="email"><label for="a-email">Email</label><input class="input" id="a-email" type="email" value="${esc(R.email)}"><span class="error">Enter a valid email address.</span></div>
            </div>
            <div class="field" data-f="state"><label for="a-state">State or UT for jurisdiction</label><select class="input" id="a-state"><option value="">Choose one</option>${D.INDIAN_STATES.map((s) => `<option ${R.state === s ? "selected" : ""}>${s}</option>`).join("")}</select><span class="error">Choose a state or union territory.</span></div>
          </div>
          <div class="form-foot"><span></span><button type="submit" class="btn btn-primary">Save settings</button></div>
        </form>

        <aside class="stack">
          <section class="stats-card">
            <h3>Current rule</h3>
            <div class="stats-grid" style="grid-template-columns:1fr">
              <div><span>Status</span><b class="${A.enabled ? "up" : "down"}">${A.enabled ? "On" : "Off"}</b></div>
              <div><span>AI score at least</span><b>${pct(A.threshold, 1)}</b></div>
              <div><span>Harm required</span><b>${A.requireHarm ? "High" : "Any"}</b></div>
              <div><span>Time to cancel</span><b>${delayLabel(A.delay)}</b></div>
              <div><span>Reported as</span><b>${esc(R.name || "—")}</b></div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Recent auto-reports</h3></div>
            ${A.log.length ? `<ul class="pipeline-list">${A.log.slice(0, 8).map((l) => `<li><span><b>${l.caseId}</b><br><span class="muted" style="font-size:12.5px">${pct(l.score, 1)} · ${fmtDate(l.at)}${l.ref ? ` · <span class="mono">${l.ref}</span>` : ""}</span></span>
              <span class="tag ${l.status === "sent" ? "tag-blue" : ""} tag-plain">${l.status === "sent" ? "Sent" : "Cancelled"}</span></li>`).join("")}</ul>`
              : `<div class="empty" style="padding:28px 20px"><p style="margin:0">None yet. Try the “Manipulated portrait” sample on the Scan page.</p></div>`}
          </section>
          <div class="notice">The model wrongly flags ${pct(D.MODEL.metrics.fpr, 1)} of real images. Keep the review window, and have an analyst check every auto-report afterwards.</div>
        </aside>
      </div>`;

    const thr = $("#a-thr");
    thr.addEventListener("input", () => {
      const v = (+thr.value).toFixed(1).split(".");
      $("#thr-out").innerHTML = `${v[0]}<small>.${v[1]}%</small>`;
    });
    $("#a-enabled").addEventListener("change", (e) => { A.enabled = e.target.checked; saveAuto(); renderAuto(); toast(A.enabled ? "Auto-report turned on" : "Auto-report turned off"); });
    $$("[data-delay]").forEach((b) => b.addEventListener("click", () => {
      $$("[data-delay]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    }));
    $("#auto-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const next = { name: $("#a-name").value.trim(), org: $("#a-org").value.trim(), phone: $("#a-phone").value.replace(/\D/g, "").slice(-10), email: $("#a-email").value.trim(), state: $("#a-state").value };
      const bad = [];
      if (next.name.length < 2) bad.push("name");
      if (!/^[6-9]\d{9}$/.test(next.phone)) bad.push("phone");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) bad.push("email");
      if (!next.state) bad.push("state");
      $$("#auto-form .field[data-f]").forEach((f) => f.classList.toggle("invalid", bad.includes(f.dataset.f)));
      if (bad.length) { const f = $(`#auto-form .field[data-f="${bad[0]}"] .input`); f && f.focus(); return; }
      A.reporter = next;
      A.threshold = +thr.value / 100;
      A.requireHarm = $("#a-harm").checked;
      const pressed = $('[data-delay][aria-pressed="true"]');
      A.delay = pressed ? +pressed.dataset.delay : A.delay;
      saveAuto();
      renderAuto();
      toast("Auto-report settings saved");
    });
  }

  // ---------- boot ----------
  function paintEnv() {
    const env = $(".topbar .env"), dot = $(".topbar .status-dot");
    if (API.live.on) {
      const h = API.live.health;
      env.textContent = `Connected to your model — ${h.model}, threshold ${Number(h.threshold).toFixed(4)}`;
      dot.classList.add("live");
    } else {
      env.textContent = "Demo mode — model server not running, scores are simulated";
      dot.classList.remove("live");
    }
  }

  window.addEventListener("hashchange", route);
  route();
  paintEnv();
  API.init().then(() => {
    paintEnv();
    if (API.live.on) { toast("Connected to your model"); if (state.scan.phase === "idle") route(); }
  });
})();
