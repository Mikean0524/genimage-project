"""Manifest based GenImage preprocessing, training, and evaluation.

The bundled sample uses real/ai; official extracts use nature/ai. No source
image is rewritten. The test split is only opened by the evaluate command.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import platform
import random
import time
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

LABELS = {"nature": 0, "real": 0, "ai": 1}
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
JPEG_QUALITY = 85


def normalize_encoding(image, quality=JPEG_QUALITY):
    """Apply the same JPEG encoding to both classes before model transforms."""
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=quality, subsampling=0)
    buffer.seek(0)
    with Image.open(buffer) as encoded:
        return encoded.convert("RGB")


def write_csv(path, rows, fields):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def inventory(root, out):
    root, out = Path(root).resolve(), Path(out)
    if not root.is_dir():
        raise FileNotFoundError(root)
    out.mkdir(parents=True, exist_ok=True)
    rows, hashes = [], defaultdict(list)
    fields = ["path", "split", "generator", "label", "status", "reason", "sha256", "width", "height", "mode", "format", "bytes"]
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name in {"manifest.csv", "summary.json", "README.md"}:
            continue
        rel = path.relative_to(root)
        parts = [p.lower() for p in rel.parts]
        split = next((p for p in parts[:-1] if p in {"train", "val", "validation", "test"}), "")
        label_name = next((p for p in parts[:-1] if p in LABELS), "")
        generator = rel.parts[0] if parts[0] not in {"train", "val", "validation", "test"} else "unknown"
        row = dict(path=str(rel).replace("\\", "/"), split=split, generator=generator,
                   label=LABELS.get(label_name, ""), status="ok", reason="", sha256="",
                   width="", height="", mode="", format="", bytes=path.stat().st_size)
        if not split or not label_name:
            row.update(status="unclassified", reason="missing split or class directory")
        elif path.suffix.lower() not in EXTENSIONS:
            row.update(status="unsupported", reason="unsupported extension")
        else:
            try:
                with Image.open(path) as image:
                    image.verify()
                with Image.open(path) as image:
                    image.load()
                    row.update(width=image.width, height=image.height, mode=image.mode, format=image.format)
                digest = hashlib.sha256()
                with path.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
                row["sha256"] = digest.hexdigest()
                hashes[row["sha256"]].append(row)
            except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
                row.update(status="invalid", reason=f"{type(exc).__name__}: {exc}")
        rows.append(row)
    # Keep official split boundaries. Evaluation overlap is quarantined, never
    # silently moved into another split.
    conflicts = []
    for group in hashes.values():
        if len(group) > 1:
            conflicts.append([r["path"] for r in group])
            if len({r["label"] for r in group}) > 1:
                for row in group:
                    row.update(status="conflict", reason="same bytes have different labels")
            else:
                priority = {"train": 0, "val": 1, "validation": 1, "test": 2}
                group.sort(key=lambda r: (priority[r["split"]], r["path"]))
                for row in group[1:]:
                    row.update(status="duplicate", reason=f"exact duplicate of {group[0]['path']}")
    write_csv(out / "inventory.csv", rows, fields)
    write_csv(out / "exclusions.csv", [r for r in rows if r["status"] != "ok"], fields)
    accepted = [r for r in rows if r["status"] == "ok"]
    counts = Counter((r["split"], r["label"]) for r in accepted)
    summary = {"root": str(root), "total_files": len(rows), "accepted": len(accepted),
               "status": dict(Counter(r["status"] for r in rows)),
               "split_class_counts": [{"split": s, "label": label, "count": n} for (s, label), n in sorted(counts.items())],
               "formats": dict(Counter(r["format"] for r in accepted)),
               "modes": dict(Counter(r["mode"] for r in accepted)),
               "dimensions_top_20": Counter(f"{r['width']}x{r['height']}" for r in accepted).most_common(20),
               "exact_duplicate_groups": conflicts,
               "near_duplicate_status": "not assessed; review perceptual similarities before benchmark claims"}
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    if counts:
        names = [f"{s} {'AI' if l == 1 else 'real'}" for s, l in sorted(counts)]
        values = [counts[k] for k in sorted(counts)]
        plt.figure(figsize=(max(7, len(names) * 1.2), 4))
        plt.bar(names, values)
        plt.xticks(rotation=35, ha="right")
        plt.ylabel("Accepted images")
        plt.tight_layout()
        plt.savefig(out / "class_distribution.png")
        plt.close()
    fig, axes = plt.subplots(2, 4, figsize=(10, 5))
    for label in (0, 1):
        selected = [r for r in accepted if r["label"] == label and r["split"] == "train"][:4]
        for axis, row in zip(axes[label], selected):
            with Image.open(root / row["path"]) as image:
                axis.imshow(ImageOps.exif_transpose(image).convert("RGB"))
            axis.set_title("AI" if label else "real")
        for axis in axes[label]:
            axis.axis("off")
    fig.tight_layout()
    fig.savefig(out / "samples.png")
    plt.close(fig)
    print(json.dumps({k: summary[k] for k in ("total_files", "accepted", "status", "split_class_counts")}, indent=2))


def load_rows(manifest, split, limit=0):
    with Path(manifest).open(newline="", encoding="utf-8") as stream:
        rows = [r for r in csv.DictReader(stream) if r["status"] == "ok" and r["split"] == split]
    if limit:
        # Stable balanced pilot independent of filesystem enumeration order.
        selected = []
        for label in ("0", "1"):
            group = sorted((r for r in rows if r["label"] == label), key=lambda r: r["sha256"])
            selected.extend(group[:limit // 2])
        rows = selected
    if not rows or {r["label"] for r in rows} != {"0", "1"}:
        raise ValueError(f"Split {split} needs both classes; found {len(rows)} rows")
    return rows


def model_modules():
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, Dataset
    from torchvision import models, transforms
    return torch, nn, DataLoader, Dataset, models, transforms


def make_dataset(root, rows, training, size, Dataset, transforms, normalize=False):
    class Images(Dataset):
        def __len__(self):
            return len(rows)

        def __getitem__(self, index):
            row = rows[index]
            with Image.open(Path(root) / row["path"]) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
            if normalize:
                image = normalize_encoding(image, random.randint(75, 95) if training else JPEG_QUALITY)
            return transform(image), int(row["label"]), row["path"]

    transform = transforms.Compose([
        transforms.Resize((size, size)),
        *([transforms.RandomHorizontalFlip()] if training else []),
        transforms.ToTensor(),
        transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
    ])
    return Images()


def seed_all(seed, torch):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def create_model(models, pretrained):
    weights = models.ResNet50_Weights.IMAGENET1K_V2 if pretrained else None
    model = models.resnet50(weights=weights)
    model.fc = __import__("torch").nn.Linear(model.fc.in_features, 2)
    return model


def epoch(model, loader, device, torch, criterion, optimizer=None, scaler=None):
    training = optimizer is not None
    model.train(training)
    losses, labels, scores = [], [], []
    start = time.perf_counter()
    for images, target, _ in loader:
        images, target = images.to(device), target.to(device)
        if training:
            optimizer.zero_grad(set_to_none=True)
        with torch.set_grad_enabled(training):
            with torch.autocast(device_type="cuda", enabled=device.type == "cuda"):
                logits = model(images)
                loss = criterion(logits, target)
            if training:
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
        losses.append(loss.item() * len(target))
        labels.extend(target.cpu().tolist())
        scores.extend(logits.softmax(1)[:, 1].detach().cpu().tolist())
    return {"loss": sum(losses) / len(labels), "labels": labels, "scores": scores,
            "seconds": time.perf_counter() - start}


def train(args):
    torch, nn, DataLoader, Dataset, models, transforms = model_modules()
    from sklearn.metrics import accuracy_score, average_precision_score, f1_score, roc_auc_score
    seed_all(args.seed, torch)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    train_rows = load_rows(args.manifest, "train", args.limit)
    val_rows = load_rows(args.manifest, "val", max(2, args.limit // 4) if args.limit else 0)
    if {r["sha256"] for r in train_rows} & {r["sha256"] for r in val_rows}:
        raise ValueError("Exact hash overlap between train and val")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    loaders = [DataLoader(make_dataset(args.data_root, rows, training, args.size, Dataset, transforms, args.normalize_encoding),
                          batch_size=args.batch_size, shuffle=training, num_workers=args.workers,
                          pin_memory=device.type == "cuda") for rows, training in ((train_rows, True), (val_rows, False))]
    model = create_model(models, not args.no_pretrained).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    criterion = nn.CrossEntropyLoss()
    config = vars(args) | {"device": str(device), "torch": torch.__version__,
                           "torchvision": __import__("torchvision").__version__, "python": platform.python_version(),
                           "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
                           "train_count": len(train_rows), "val_count": len(val_rows)}
    (out / "config.json").write_text(json.dumps(config, indent=2, default=str), encoding="utf-8")
    history, best, stale = [], -1., 0
    for number in range(1, args.epochs + 1):
        tr = epoch(model, loaders[0], device, torch, criterion, optimizer, scaler)
        va = epoch(model, loaders[1], device, torch, criterion)
        auc = roc_auc_score(va["labels"], va["scores"])
        ap = average_precision_score(va["labels"], va["scores"])
        row = {"epoch": number, "train_loss": tr["loss"], "val_loss": va["loss"],
               "train_accuracy_0_5": accuracy_score(tr["labels"], np.array(tr["scores"]) >= 0.5),
               "val_accuracy_0_5": accuracy_score(va["labels"], np.array(va["scores"]) >= 0.5),
               "val_f1_0_5": f1_score(va["labels"], np.array(va["scores"]) >= 0.5),
               "val_roc_auc": auc, "val_average_precision": ap,
               "train_seconds": tr["seconds"], "val_seconds": va["seconds"], "lr": optimizer.param_groups[0]["lr"]}
        history.append(row)
        write_csv(out / "epochs.csv", history, list(row))
        print(json.dumps(row), flush=True)
        if auc > best + 1e-5:
            best, stale = float(auc), 0
            torch.save({"state_dict": model.state_dict(), "size": args.size, "epoch": number,
                        "normalize_encoding": args.normalize_encoding,
                        "best_val_roc_auc": best, "architecture": "resnet50"}, out / "best.pt")
        else:
            stale += 1
        scheduler.step()
        if stale >= args.patience:
            break
    plt.plot([r["epoch"] for r in history], [r["train_loss"] for r in history], label="train")
    plt.plot([r["epoch"] for r in history], [r["val_loss"] for r in history], label="validation")
    plt.xlabel("Epoch")
    plt.ylabel("Cross entropy")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out / "loss_curves.png")
    plt.close()


def predict(model, loader, device, torch):
    model.eval()
    labels, scores, paths = [], [], []
    start = time.perf_counter()
    with torch.inference_mode():
        for images, target, batch_paths in loader:
            with torch.autocast(device_type="cuda", enabled=device.type == "cuda"):
                score = model(images.to(device)).softmax(1)[:, 1]
            labels.extend(target.tolist())
            scores.extend(score.cpu().tolist())
            paths.extend(batch_paths)
    if device.type == "cuda":
        torch.cuda.synchronize()
    return np.array(labels), np.array(scores), paths, time.perf_counter() - start


def evaluate(args):
    torch, _, DataLoader, Dataset, models, transforms = model_modules()
    from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix,
                                 f1_score, precision_recall_curve, precision_score, recall_score,
                                 roc_auc_score, roc_curve)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    # Checkpoints are produced locally by this script. The first saved runs may
    # contain a NumPy scalar metric, which weights_only cannot deserialize.
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    size = checkpoint["size"]
    model = create_model(models, False)
    model.load_state_dict(checkpoint["state_dict"])
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    def run(split):
        rows = load_rows(args.manifest, split)
        loader = DataLoader(make_dataset(args.data_root, rows, False, size, Dataset, transforms,
                                         checkpoint.get("normalize_encoding", False)),
                            batch_size=args.batch_size, num_workers=args.workers)
        return rows, predict(model, loader, device, torch)
    val_rows, (vy, vs, _, _) = run("val")
    # Optimize validation F1; tie break toward higher threshold to reduce false positives.
    thresholds = sorted(set(vs.tolist()) | {0.5})
    threshold = max(thresholds, key=lambda t: (f1_score(vy, vs >= t), t))
    rows, (y, scores, paths, seconds) = run("test")
    pred = (scores >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    metrics = {"positive_class": "AI-generated (1)", "threshold": threshold,
               "threshold_method": "maximum validation F1, higher threshold on ties",
               "validation_count": len(vy), "test_count": len(y),
               "accuracy": accuracy_score(y, pred), "precision": precision_score(y, pred, zero_division=0),
               "recall": recall_score(y, pred, zero_division=0), "f1": f1_score(y, pred, zero_division=0),
               "roc_auc": roc_auc_score(y, scores), "average_precision": average_precision_score(y, scores),
               "confusion_matrix_real_ai": [[int(tn), int(fp)], [int(fn), int(tp)]],
               "false_positive_rate": fp / (fp + tn), "false_negative_rate": fn / (fn + tp),
               "seconds_per_image": seconds / len(y), "images_per_second": len(y) / seconds,
               "timing_note": "batch loading, preprocessing and model inference included; first pass includes warmup"}
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    write_csv(out / "predictions.csv", [dict(path=p, label=int(a), score=float(s), prediction=int(b)) for p, a, s, b in zip(paths, y, scores, pred)],
              ["path", "label", "score", "prediction"])
    fpr, tpr, _ = roc_curve(y, scores)
    precision, recall, _ = precision_recall_curve(y, scores)
    for x, yy, title, file in [(fpr, tpr, "ROC", "roc.png"), (recall, precision, "Precision recall", "pr.png")]:
        plt.plot(x, yy)
        plt.xlabel("False positive rate" if file == "roc.png" else "Recall")
        plt.ylabel("True positive rate" if file == "roc.png" else "Precision")
        plt.title(title)
        plt.tight_layout()
        plt.savefig(out / file)
        plt.close()
    plt.imshow([[tn, fp], [fn, tp]], cmap="Blues")
    for i, line in enumerate([[tn, fp], [fn, tp]]):
        for j, n in enumerate(line):
            plt.text(j, i, str(n), ha="center", va="center")
    plt.xticks([0, 1], ["real", "AI"])
    plt.yticks([0, 1], ["real", "AI"])
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.tight_layout()
    plt.savefig(out / "confusion.png")
    plt.close()
    print(json.dumps(metrics, indent=2))


def infer(args):
    torch, _, _, _, models, transforms = model_modules()
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    model = create_model(models, False)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    with Image.open(args.image) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    if checkpoint.get("normalize_encoding", False):
        image = normalize_encoding(image)
    transform = transforms.Compose([transforms.Resize((checkpoint["size"],) * 2), transforms.ToTensor(),
                                    transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))])
    with torch.inference_mode():
        score = model(transform(image).unsqueeze(0)).softmax(1)[0, 1].item()
    print(json.dumps({"image": str(args.image), "ai_score_uncalibrated": score,
                      "assessment": "AI-generated" if score >= args.threshold else "real",
                      "threshold": args.threshold}))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("--data-root", type=Path, default=os.environ.get("GENIMAGE_ROOT"), required=False)
    inspect.add_argument("--out", default="outputs/inspection")
    train_parser = sub.add_parser("train")
    train_parser.add_argument("--data-root", type=Path, default=os.environ.get("GENIMAGE_ROOT"))
    train_parser.add_argument("--manifest", default="outputs/inspection/inventory.csv")
    train_parser.add_argument("--out", default="outputs/baseline")
    train_parser.add_argument("--epochs", type=int, default=10)
    train_parser.add_argument("--patience", type=int, default=3)
    train_parser.add_argument("--batch-size", type=int, default=16)
    train_parser.add_argument("--workers", type=int, default=0)
    train_parser.add_argument("--size", type=int, default=224)
    train_parser.add_argument("--lr", type=float, default=1e-4)
    train_parser.add_argument("--seed", type=int, default=42)
    train_parser.add_argument("--limit", type=int, default=0, help="Balanced train pilot size; 0 means all")
    train_parser.add_argument("--no-pretrained", action="store_true", help="Only for pipeline checks, not the baseline")
    train_parser.add_argument("--normalize-encoding", action="store_true",
                              help="Re-encode both classes as JPEG; validation and inference use quality 85")
    evaluate_parser = sub.add_parser("evaluate")
    evaluate_parser.add_argument("--data-root", type=Path, default=os.environ.get("GENIMAGE_ROOT"))
    evaluate_parser.add_argument("--manifest", default="outputs/inspection/inventory.csv")
    evaluate_parser.add_argument("--checkpoint", required=True)
    evaluate_parser.add_argument("--out", default="outputs/evaluation")
    evaluate_parser.add_argument("--batch-size", type=int, default=16)
    evaluate_parser.add_argument("--workers", type=int, default=0)
    inference_parser = sub.add_parser("infer")
    inference_parser.add_argument("--checkpoint", required=True)
    inference_parser.add_argument("--image", required=True, type=Path)
    inference_parser.add_argument("--threshold", required=True, type=float,
                                  help="Use threshold from evaluation metrics.json")
    args = parser.parse_args()
    if args.command in {"inspect", "train", "evaluate"} and args.data_root is None:
        parser.error("provide --data-root or GENIMAGE_ROOT")
    {"inspect": lambda: inventory(args.data_root, args.out), "train": lambda: train(args),
     "evaluate": lambda: evaluate(args), "infer": lambda: infer(args)}[args.command]()


if __name__ == "__main__":
    main()
