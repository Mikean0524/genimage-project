"""Evaluate the published Detectra checkpoint on this project's labeled test split."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.metrics import accuracy_score, confusion_matrix, roc_auc_score

from detectra_predictor import DEFAULT_MODEL, FRONTIER_MODEL, DetectraPredictor, FrontierPredictor


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, default=Path("data/genimage_sample"))
    parser.add_argument("--manifest", type=Path, default=Path("outputs/inspection/inventory.csv"))
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--kind", choices=("detectra", "frontier"), default="detectra")
    parser.add_argument("--per-class", type=int, default=100, help="0 evaluates all test images")
    parser.add_argument("--threshold", type=float, default=0.65)
    parser.add_argument("--out", type=Path, default=Path("outputs/detectra_eval"))
    args = parser.parse_args()
    if args.kind == "frontier" and args.model == DEFAULT_MODEL:
        args.model = FRONTIER_MODEL
    with args.manifest.open(newline="", encoding="utf-8") as stream:
        rows = [r for r in csv.DictReader(stream) if r["split"] == "test" and r["status"] == "ok"]
    if args.per_class:
        rows = [r for label in ("0", "1") for r in sorted(
            (r for r in rows if r["label"] == label), key=lambda r: r["sha256"])[:args.per_class]]
    detector = (FrontierPredictor if args.kind == "frontier" else DetectraPredictor)(args.model)
    labels, scores = [], []
    for index, row in enumerate(rows, 1):
        with Image.open(args.data_root / row["path"]) as image:
            scores.append(detector.score(image))
        labels.append(int(row["label"]))
        if index % 100 == 0:
            print(f"scored {index}/{len(rows)}", flush=True)
    labels, scores = np.asarray(labels), np.asarray(scores)
    predicted = scores >= args.threshold
    result = {"model": str(args.model), "threshold": args.threshold,
              "count": len(rows), "accuracy": accuracy_score(labels, predicted),
              "roc_auc": roc_auc_score(labels, scores),
              "confusion_matrix_real_ai": confusion_matrix(labels, predicted, labels=[0, 1]).tolist(),
              "mean_score_real": float(scores[labels == 0].mean()),
              "mean_score_ai": float(scores[labels == 1].mean())}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    with (args.out / "predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["path", "label", "score", "prediction"])
        writer.writerows((r["path"], label, score, int(pred)) for r, label, score, pred in zip(rows, labels, scores, predicted))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
