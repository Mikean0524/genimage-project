# GenImage pipeline

The [official repository](https://github.com/GenImage-Dataset/GenImage) documents Midjourney, VQDM, Wukong, Stable Diffusion V1.4, Stable Diffusion V1.5, GLIDE, BigGAN, and ADM. Extracted folders are generator / `train` or `val` / `ai` or `nature`. The paper evaluates across generators and under image degradation. The [official license](https://github.com/GenImage-Dataset/GenImage/blob/main/License) states CC BY-NC-SA 4.0 with additional noncommercial dataset terms. The full dataset is large; download links are in the official README.

This workspace has a 9,749-image curated GenImage-derived mirror sample. It is **not** the paper's test set. Source train was partitioned by image hash into train/val; one source validation shard became held-out test. One exact duplicate was excluded during materialization. The local inventory confirms all 9,749 remaining images decode. Near duplicates have not been ruled out. The sample has a serious shortcut: real images are JPEG and generated images are PNG. High accuracy may reflect encoding differences.

## Run in order

Use Python 3.10+ and install `requirements-ml.txt` with a PyTorch/torchvision build appropriate to your CPU or CUDA version. The baseline is pretrained ResNet-50 with two logits, cross entropy, AdamW, cosine scheduling, 224-square resize, ImageNet normalization, and training-only horizontal flip. Square resize distorts aspect ratio. Validation/test transforms are deterministic.

```powershell
python -m pip install -r requirements-ml.txt
```

On a restricted Windows installation, set `$env:TORCH_HOME` to a writable directory inside this project before the first training run so pretrained weights can be cached.

```powershell
python src/genimage_pipeline.py inspect --data-root data/genimage_sample
```

Review `outputs/inspection/summary.json`, `inventory.csv`, `exclusions.csv`, `class_distribution.png`, and `samples.png`. Expected counts: train 3,220 real/3,186 AI; val 779 real/814 AI; test 875/875. Supply an actual `--data-root` for another extracted dataset. For an official extract with only train/val, first create a documented model-validation partition from official train, then reserve official val for final test; the commands require distinct train, val, test folders.

```powershell
python src/genimage_pipeline.py train --data-root data/genimage_sample --limit 200 --epochs 1 --out outputs/pilot
python src/genimage_pipeline.py train --data-root data/genimage_sample --epochs 10 --out outputs/baseline
```

The pilot validates plumbing and is not a benchmark. Pretrained weights download on first use. CPU training may take many hours; CUDA mixed precision is automatic. Decrease `--batch-size` if memory is insufficient. Expect `epochs.csv`, `config.json`, `best.pt`, and `loss_curves.png`. The best checkpoint maximizes validation ROC-AUC. For comparisons, vary one hyperparameter per run and use distinct output folders.

For this sample, train a new checkpoint with `--normalize-encoding` to reduce the JPEG/PNG class shortcut. Both labels are re-encoded as JPEG before resizing. Training uses randomly selected quality 75–95; validation, test, CLI inference, and the server use quality 85. Existing checkpoints retain their original preprocessing. This cannot undo artifacts already present in source JPEGs or prove generalization; compare on a new, independently sourced test set with matched formats and image sizes.

```powershell
python src/genimage_pipeline.py train --data-root data/genimage_sample --manifest outputs/inspection/inventory.csv --normalize-encoding --epochs 2 --out outputs/encoding_normalized
python src/genimage_pipeline.py evaluate --data-root data/genimage_sample --manifest outputs/inspection/inventory.csv --checkpoint outputs/encoding_normalized/best.pt --out outputs/encoding_normalized_eval
python server/app.py --detector resnet --checkpoint outputs/encoding_normalized/best.pt --metrics outputs/encoding_normalized_eval/metrics.json
```

The two-epoch normalized run selected epoch 2 (validation ROC-AUC 0.9801). On the same 1,750-image test partition used by the original baseline, its validation-selected threshold was 0.3633, test accuracy 91.2%, and confusion matrix `[[782, 93], [61, 814]]` (real/AI rows and columns). The original baseline had 90.8% accuracy and `[[752, 123], [38, 837]]`. False positives fell from 123 to 93, while missed AI images rose from 38 to 61. Because this test partition has now been reused for comparison, it is not an untouched benchmark for future model selection. The remaining source-format and size differences still require a better matched dataset and outside-image evaluation.

After choosing the run by validation results, evaluate the test once:

```powershell
python src/genimage_pipeline.py evaluate --data-root data/genimage_sample --checkpoint outputs/baseline/best.pt
```

The threshold maximizes validation F1, breaking ties toward the higher threshold. `outputs/evaluation/` contains `metrics.json`, `predictions.csv`, `confusion.png`, `roc.png`, and `pr.png`. Metrics include accuracy, precision, recall, F1, ROC-AUC, average precision, FPR, FNR, and batch-inclusive inference throughput. Confusion rows are actual real/AI; columns are predicted real/AI. False positive means real called AI; false negative means AI called real.

```powershell
python src/genimage_pipeline.py infer --checkpoint outputs/baseline/best.pt --image path/to/image.jpg --threshold 0.5
```

Replace `0.5` with the value in `metrics.json`. Scores are uncalibrated assessments, not proof. Review train/validation loss gaps, class-specific errors, format shortcut, possible near duplicates, resize effects, and absence of a genuine unseen-generator test. Compression robustness and generator-specific paired-control evaluation are future experiments.

Only load checkpoints you created or trust; PyTorch checkpoint loading can execute serialized code.

## Troubleshooting

- Missing torchvision: install into the same Python interpreter.
- Weight download failure: provide network or a cached torchvision weight file. `--no-pretrained` is only a wiring check.
- Missing split/class: inspect the inventory and directory names. Do not use the same split for selection and final test.
- Decode error during training: rescan because files may have changed since inventory.
- CUDA memory error: lower batch size.
