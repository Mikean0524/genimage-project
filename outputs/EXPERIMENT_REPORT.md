# GenImage-derived sample experiment report

## Protocol and data checks

Positive class: AI-generated = 1; real = 0. This experiment uses the local `TheKernel01/Tiny-GenImage` mirror sample, not the full official GenImage benchmark. Four source training shards were partitioned deterministically into train/validation; one source validation shard was held out as test. One exact duplicate was excluded during source materialization. The new inventory scanned all 9,749 remaining files, accepted all 9,749, and found zero unreadable, unsupported, or exact-duplicate files. Per-split counts were train 3,220 real / 3,186 AI; validation 779 / 814; test 875 / 875. Near duplicates were not assessed.

**Critical shortcut:** all 4,874 real images are JPEG and all 4,875 AI images are PNG. A model can exploit encoding, color-mode, or associated preprocessing artifacts. The result does not establish robust AI-image detection. Dimensions and modes are recorded in `inspection/summary.json`; image examples and class counts are in `inspection/samples.png` and `inspection/class_distribution.png`.

## Model and experiments

Pretrained torchvision ResNet-50, two logits, cross entropy, AdamW at 0.0001, weight decay 0.0001, cosine learning-rate schedule, 224 × 224 resize, ImageNet normalization, training-only horizontal flip, batch size 16 for full training, seed 42. CPU-only environment, PyTorch 2.7.1 and torchvision 0.22.1. Best checkpoint selected by validation ROC-AUC. Scores are uncalibrated. `baseline/config.json` holds the exact run configuration.

| Run | Training images | Epochs | Validation ROC-AUC | Validation AP | Role |
|---|---:|---:|---:|---:|---|
| Untrained-weight smoke check | 20 | 1 | 0.500 | 0.583 | Loader/optimizer check only |
| Pretrained pilot | 200 | 2 | 0.760 | 0.791 | Pipeline check only |
| Full baseline | 6,406 | 2 | 0.983 | 0.984 | Selected model |

Full run epoch 1: train loss 0.367, validation loss 0.210, validation accuracy at 0.5 was 0.914. Epoch 2: train loss 0.132, validation loss 0.171, validation accuracy at 0.5 was 0.930. Both train and validation loss fell; there is no clear overfitting signal in these two epochs, though the format shortcut dominates interpretation. The two epochs took about 21.5 minutes including validation on this CPU. See `baseline/epochs.csv` and `baseline/loss_curves.png`.

## Final held-out test

Threshold **0.2714381218** was chosen to maximize validation F1, with a higher threshold breaking ties. Test scores were computed once after this choice. The test has 1,750 images.

| Metric | Value |
|---|---:|
| Accuracy | 0.9080 |
| Precision (AI) | 0.8719 |
| Recall (AI) | 0.9566 |
| F1 (AI) | 0.9123 |
| ROC-AUC | 0.9760 |
| Average precision | 0.9792 |
| False-positive rate | 0.1406 |
| False-negative rate | 0.0434 |
| Seconds per image, batch-inclusive | 0.0333 |
| Throughput, images/second | 30.06 |

Confusion matrix, actual rows and predicted columns (real, AI): `[[752, 123], [38, 837]]`. Thus 123 real images were falsely accused of being AI, while 38 AI images were missed. The validation-selected threshold favors AI recall at the cost of real-image false positives. Timing includes image loading and transforms, with batch size 16 and warmup included. The authoritative numeric outputs are in `evaluation/metrics.json`; curves and per-image scores are in `evaluation/`.

## Interpretation and limitations

The real class has 752/875 correct (86.0% specificity), and the AI class has 837/875 correct (95.7% sensitivity). The high false-positive rate makes the current detector unsuitable for authenticity decisions or accusations. The perfect JPEG/PNG class split can explain much of the apparent performance; the model may learn compression or format cues. Resizing to square can remove or distort forensic details. No controlled recompression, resolution, blur, or quality experiment was run, so sensitivity to those changes is unknown. The mirror sample omits SD V1.4, covers only selected shards, and does not implement a genuinely held-out-generator protocol; no unseen-generator generalization is claimed. Real images have no matching generator grouping in this mirror, so generator-specific accuracy with paired real controls was not reported. Possible near-duplicate leakage remains an unquantified risk despite exact-hash checks.

For a credible next experiment, use an official split or another properly licensed dataset with the same encoding and preprocessing distribution for both classes, inspect near duplicates, and evaluate a generator excluded from both training and validation. Keep the current test results fixed; new model decisions need a new untouched evaluation set.
