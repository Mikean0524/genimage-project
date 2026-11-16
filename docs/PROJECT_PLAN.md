# GenImage AI-Generated Image Detection Project

## Purpose and scope

Build a reproducible image-only binary classifier using GenImage. Current scope is dataset inspection/preprocessing, baseline training, and evaluation. Source tracing, moderation, face-swap detection, and reporting are out of scope.

Positive class convention: AI-generated = 1. Real/ImageNet `nature` = 0.

## Verified dataset reference

Official repository: https://github.com/GenImage-Dataset/GenImage
Paper: https://papers.nips.cc/paper_files/paper/2023/file/f4d4a021f9051a6c18183b059117e8b5-Paper-Datasets_and_Benchmarks.pdf

Documented generator subsets: `Midjourney`, `VQDM`, `Wukong`, `Stable Diffusion V1.4`, `Stable Diffusion V1.5`, `GLIDE`, `BigGAN`, and `ADM`. The documented extracted layout is generator / `train` or `val` / `ai` or `nature`. Actual names and counts must be discovered from the supplied local data; do not assume all subsets are present or equal in size.

The paper describes cross-generator evaluation and degraded-image evaluation (e.g. blur, low resolution, compression). Preserve the official split when present. The official README refers to Google Drive and Baidu Yunpan. The official repository License states CC BY-NC-SA 4.0 with additional dataset terms restricting commercial use. Storage requirements depend on the downloaded subsets; check their sizes before acquisition.

## Execution protocol

Work through the tasks in order. Do not train until inspection and preprocessing validation have been reviewed. Keep the official test split untouched during model selection. Record commands, configs, software/hardware, exclusions, and outputs. A small smoke run may validate plumbing, but report it separately from benchmark results. Never claim unseen-generator generalization unless a generator was held out from training and validation.

## Task breakdown and status

- [x] Task 0 — Project reference and staged plan (`docs/PROJECT_PLAN.md`).
- [ ] Task 1 — Dataset discovery and inspection: enumerate real on-disk generator/split/class directories; count supported and unsupported files; inspect formats, dimensions, modes, readability, class counts, hashes, and duplicate overlap; produce CSV/JSON report and plots. Do not invent a root path; require `GENIMAGE_ROOT` or a CLI argument.
- [ ] Task 2 — Preprocessing validation: stable manifest with labels (`nature=0`, `ai=1`), invalid-file log and explicit exclusion reasons; exact-duplicate analysis across splits; deterministic resize/normalization and training-only conservative augmentation; validate sample batches. Avoid destructive rewriting of source data.
- [ ] Task 3 — Baseline experiment: pretrained torchvision ResNet-50, two logits, cross-entropy, AdamW, seed control, GPU/mixed precision when available, epoch logs, best validation checkpoint, early stopping. Start with a documented manageable subset, then scale only after successful validation.
- [ ] Task 4 — Model selection: compare a small predefined set of learning rate / batch size / resolution / conservative augmentation settings on validation only. Log each config and resource/time measures.
- [ ] Task 5 — Threshold selection and final evaluation: select threshold using validation only; run the untouched official test set once for accuracy, precision, recall, F1, confusion matrix, ROC-AUC, PR/AP, FPR/FNR, inference latency/throughput, and generator-specific results where possible.
- [ ] Task 6 — Reporting and inference: loss curves; class plots/sample grid; ROC/PR/confusion visualizations; experiment table; limitations/leakage/compression discussion; CLI instructions for one new image.

## Initial engineering decisions

- Primary baseline: pretrained ResNet-50 in PyTorch/torchvision for broad support, reproducibility, and straightforward transfer learning.
- Model input: begin with 224x224 and ImageNet normalization expected by pretrained weights; keep validation/test transforms deterministic. Confirm the installed torchvision weight API before implementation.
- Augmentation: initially horizontal flip only if it does not invalidate content semantics; avoid aggressive crops, blur, sharpening, recompression, and color changes because they may erase or create forensic cues. Any degradation robustness experiment is an explicit separate evaluation.
- Duplicates: exact cryptographic hashes are deterministic; perceptual near-duplicate checks are an additional diagnostic and must be reviewed before exclusions. Never silently remove data.
- Outputs: generated reports, manifests, plots, checkpoints, and logs go under `outputs/`; source data stays read-only.

## Environment and run configuration

No dataset path is hard-coded. Set `GENIMAGE_ROOT` to the extracted dataset directory or provide `--data-root` to commands. Record the actual path in run metadata but keep machine-specific paths out of committed manifests where practical.

Expected initial outputs from Task 1: `outputs/inspection/summary.json`, `outputs/inspection/files.csv`, `outputs/inspection/class_distribution.png`, `outputs/inspection/samples.png`, and `outputs/inspection/invalid_files.csv`.

## Completion criteria

A stage is complete only when its outputs exist and its validation checks pass. Dataset counts and exclusions must reconcile against the scanned file inventory. Training must save config and per-epoch metrics. Final evaluation must state threshold selection, positive class, split and generator protocol, and observed limitations.

## Storage cap (user requirement)

Hard working-data cap: 1.5 GB (use 1,500,000,000 bytes for conservative accounting). This means a curated, balanced GenImage sample, not the full official benchmark. The full benchmark is reported at 2,681,167 images; public mirrors report hundreds of GB, so the full benchmark cannot fit. Keep archives + extracted files + generated copies within the cap; prefer a manifest referencing source files and avoid duplicate copies. Before any download, confirm source archive sizes and ensure the selected files can be fetched independently. Never download a multi-GB archive and then delete most of it. If official hosting does not offer independently downloadable small units, use an explicitly documented sample from a mirror or stop before download rather than exceed the cap. The selected sample must preserve class balance and available source split boundaries; disclose that reduced scale limits benchmark claims.

## Dataset acquisition result (2026-10-28)

The full official benchmark cannot meet the requested 3 GB limit. Instead, the project now has a curated GenImage-derived sample from TheKernel01/Tiny-GenImage: four source-train shards and one source-validation shard, selected after checking their individual CDN sizes. The image files and manifests occupy 2,320,339,999 bytes. Source Parquet files were removed as images were extracted and verified, avoiding duplicate storage. There are 9,749 unique readable images after excluding one exact duplicate; no corrupt images were found in this sample.

Split protocol for this working subset: source train records were deterministically split by image SHA-256 into 6,406 train and 1,593 validation records; the 1,750-record source validation shard is the held-out test partition. This is not the original paper's official test split. Generator coverage includes ADM, BigGAN, GLIDE, Midjourney, SD15, VQDM, and Wukong; SD14 is absent from these selected shards. `data/genimage_sample/summary.json` and `manifest.csv` preserve the inventory and exclusions. Class/sample visualizations remain pending before Task 1 can be marked complete.

- [x] Task 1a — Acquire and materialize a size-capped GenImage-derived sample; preflight storage, labels, formats, dimensions, split counts, exact duplicates, and invalid files.
- [ ] Task 1b — Generate class-distribution and sample-image visualizations; review aspect ratios and color modes before defining model transforms.
