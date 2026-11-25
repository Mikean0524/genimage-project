/* Sample data for the frontend prototype.
   Model figures come from outputs/EXPERIMENT_REPORT.md in the repository.
   Everything else (cases, people, URLs) is fictional sample data. */
(function () {
  "use strict";

  // Deterministic PRNG so sample data is stable between reloads.
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  // Abstract placeholder "photo": colour field + head-and-shoulders silhouette.
  // Real evidence images are never bundled with the frontend.
  function placeholderImage(seed) {
    const r = rng(seed);
    const hues = [205, 18, 280, 150, 340, 40, 190];
    const h1 = hues[Math.floor(r() * hues.length)];
    const h2 = (h1 + 40 + Math.floor(r() * 80)) % 360;
    const cx = 120 + Math.floor(r() * 80);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${h1},45%,38%)"/><stop offset="1" stop-color="hsl(${h2},50%,22%)"/></linearGradient></defs>` +
      `<rect width="320" height="240" fill="url(#g)"/>` +
      `<circle cx="${40 + r() * 240}" cy="${30 + r() * 80}" r="${30 + r() * 50}" fill="hsl(${h2},60%,60%)" opacity=".25"/>` +
      `<ellipse cx="${cx}" cy="98" rx="38" ry="46" fill="hsl(${h1},25%,72%)" opacity=".9"/>` +
      `<path d="M${cx - 92} 240 C ${cx - 82} 170, ${cx - 40} 150, ${cx} 150 S ${cx + 82} 170, ${cx + 92} 240 Z" fill="hsl(${h1},20%,62%)" opacity=".9"/>` +
      `</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const GENERATORS = ["ADM", "BigGAN", "GLIDE", "Midjourney", "SD15", "VQDM", "Wukong"];

  const MODEL = {
    name: "ResNet-50 baseline",
    framework: "PyTorch 2.7.1 · torchvision 0.22.1",
    input: "224 × 224, ImageNet normalisation",
    threshold: 0.2714381218,
    trainedOn: "Tiny-GenImage sample — 6,406 train / 1,593 val / 1,750 test images",
    metrics: {
      accuracy: 0.908, precision: 0.8719, recall: 0.9566, f1: 0.9123,
      rocAuc: 0.976, ap: 0.9792, fpr: 0.1406, fnr: 0.0434,
      secondsPerImage: 0.0333, throughput: 30.06
    },
    confusion: { tn: 752, fp: 123, fn: 38, tp: 837 },
    epochs: [
      { epoch: 1, trainLoss: 0.367, valLoss: 0.210, valAcc: 0.914 },
      { epoch: 2, trainLoss: 0.132, valLoss: 0.171, valAcc: 0.930 }
    ]
  };

  const STATUSES = {
    new: "New",
    review: "Under review",
    traced: "Source traced",
    reported: "Reported",
    closed: "Closed"
  };

  const HARM_CATEGORIES = [
    "Sexualised depiction of a real person",
    "Face swapped onto another body",
    "Impersonation of an identifiable person",
    "Used for harassment or threats",
    "Possible extortion material"
  ];

  const now = new Date("2026-11-18T18:30:00+05:30").getTime();
  const hrs = (h) => new Date(now - h * 3600 * 1000).toISOString();

  const CASES = [
    { id: "GIF-2026-0148", title: "Morphed photo of college student shared in group chat", status: "new", score: 0.94, harm: "high", generator: "SD15", human: true, created: hrs(2), sources: 6, analyst: "Unassigned", harmCats: [0, 1, 3] },
    { id: "GIF-2026-0147", title: "Fake profile picture used for loan-app impersonation", status: "review", score: 0.81, harm: "medium", generator: "Midjourney", human: true, created: hrs(9), sources: 3, analyst: "R. Sharma", harmCats: [2] },
    { id: "GIF-2026-0146", title: "Face-swapped image of a news anchor", status: "traced", score: 0.88, harm: "high", generator: "GLIDE", human: true, created: hrs(26), sources: 11, analyst: "A. Verma", harmCats: [1, 2] },
    { id: "GIF-2026-0145", title: "Product photo flagged by marketplace seller", status: "closed", score: 0.12, harm: "none", generator: "—", human: false, created: hrs(31), sources: 0, analyst: "R. Sharma", harmCats: [] },
    { id: "GIF-2026-0144", title: "Edited image sent with payment demand", status: "reported", score: 0.97, harm: "high", generator: "SD15", human: true, created: hrs(50), sources: 4, analyst: "A. Verma", harmCats: [0, 4], ref: "GIF-RPT-7Q3K-2291" },
    { id: "GIF-2026-0143", title: "Synthetic crowd photo from protest coverage", status: "review", score: 0.63, harm: "low", generator: "Wukong", human: true, created: hrs(73), sources: 8, analyst: "S. Iyer", harmCats: [] },
    { id: "GIF-2026-0142", title: "Teacher's photo altered and posted on forum", status: "reported", score: 0.91, harm: "high", generator: "ADM", human: true, created: hrs(98), sources: 5, analyst: "S. Iyer", harmCats: [0, 3], ref: "GIF-RPT-2M8D-1840" },
    { id: "GIF-2026-0141", title: "Landscape wallpaper — authenticity check", status: "closed", score: 0.08, harm: "none", generator: "—", human: false, created: hrs(120), sources: 0, analyst: "R. Sharma", harmCats: [] },
    { id: "GIF-2026-0140", title: "Celebrity endorsement image in investment ad", status: "traced", score: 0.86, harm: "medium", generator: "Midjourney", human: true, created: hrs(146), sources: 14, analyst: "A. Verma", harmCats: [2] },
    { id: "GIF-2026-0139", title: "Matrimonial profile photo reported by user", status: "closed", score: 0.31, harm: "low", generator: "VQDM", human: true, created: hrs(171), sources: 1, analyst: "S. Iyer", harmCats: [] }
  ];
  CASES.forEach((c, i) => { c.thumb = placeholderImage(1000 + i * 37); c.demo = true; });

  const INDIAN_STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu & Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Chandigarh", "Other union territory"];

  const INCIDENT_TYPES = [
    "Morphed or deepfake intimate image",
    "Impersonation using a synthetic image",
    "Harassment or bullying with a manipulated image",
    "Extortion or sextortion",
    "Defamation or misinformation",
    "Other"
  ];

  window.GI_DATA = { rng, placeholderImage, GENERATORS, MODEL, STATUSES, HARM_CATEGORIES, CASES, INDIAN_STATES, INCIDENT_TYPES };
})();
