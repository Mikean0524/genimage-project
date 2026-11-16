"""Post-hoc encoding sensitivity diagnostic for the held-out test images.

This is not a new independent benchmark: the same test labels were already
reported. It applies the same output encoding to both classes in memory.
"""
from __future__ import annotations

import argparse
import json
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

from genimage_pipeline import load_rows


class EncodedImages(Dataset):
    def __init__(self, root, rows, size, encoding):
        self.root, self.rows, self.encoding = Path(root), rows, encoding
        self.transform = transforms.Compose([
            transforms.Resize((size, size)), transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ])

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        row = self.rows[index]
        with Image.open(self.root / row["path"]) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
        if self.encoding != "original":
            buffer = BytesIO()
            if self.encoding == "jpeg95":
                image.save(buffer, format="JPEG", quality=95, subsampling=0)
            else:
                image.save(buffer, format="PNG")
            buffer.seek(0)
            with Image.open(buffer) as decoded:
                image = decoded.convert("RGB")
        return self.transform(image), int(row["label"]), row["path"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=Path("outputs/inspection/inventory.csv"))
    parser.add_argument("--checkpoint", type=Path, default=Path("outputs/baseline/best.pt"))
    parser.add_argument("--metrics", type=Path, default=Path("outputs/evaluation/metrics.json"))
    parser.add_argument("--out", type=Path, default=Path("outputs/evaluation/format_stress_test.json"))
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    threshold = json.loads(args.metrics.read_text(encoding="utf-8"))["threshold"]
    model = models.resnet50(weights=None)
    model.fc = torch.nn.Linear(model.fc.in_features, 2)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    rows = load_rows(args.manifest, "test")
    results = {}
    with torch.inference_mode():
        for encoding in ("original", "jpeg95", "png"):
            loader = DataLoader(EncodedImages(args.data_root, rows, checkpoint["size"], encoding),
                                batch_size=args.batch_size, num_workers=0)
            labels, scores = [], []
            for images, target, _ in loader:
                labels.extend(target.tolist())
                scores.extend(model(images).softmax(1)[:, 1].tolist())
            labels, scores = np.asarray(labels), np.asarray(scores)
            predicted = (scores >= threshold).astype(int)
            results[encoding] = {
                "count": len(labels), "accuracy": accuracy_score(labels, predicted),
                "f1": f1_score(labels, predicted), "roc_auc": roc_auc_score(labels, scores),
                "confusion_matrix_real_ai": confusion_matrix(labels, predicted, labels=[0, 1]).tolist(),
                "mean_ai_score_real": float(scores[labels == 0].mean()),
                "mean_ai_score_ai": float(scores[labels == 1].mean()),
            }
            print(encoding, json.dumps(results[encoding]), flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"threshold_fixed_from_validation": threshold,
                                    "encoding_conditions": results,
                                    "interpretation": "post-hoc sensitivity check on already-used test labels, not a fresh independent benchmark"}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
