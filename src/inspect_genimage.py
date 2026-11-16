from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

SUPPORTED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
LABELS = {"nature": 0, "ai": 1}
SPLITS = {"train", "val", "validation", "test"}


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_image(path: Path) -> dict[str, Any]:
    row: dict[str, Any] = {
        "path": str(path), "suffix": path.suffix.lower(), "bytes": path.stat().st_size,
        "width": None, "height": None, "mode": None, "format": None,
        "sha256": None, "status": "ok", "reason": "",
    }
    if path.suffix.lower() not in SUPPORTED_SUFFIXES:
        row.update(status="unsupported", reason="unsupported_extension")
        return row
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            row.update(width=image.width, height=image.height, mode=image.mode, format=image.format)
        row["sha256"] = sha256_file(path)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        row.update(status="invalid", reason=f"{type(exc).__name__}: {exc}")
    return row


def discover(root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Dataset root does not exist or is not a directory: {root}")
    rows: list[dict[str, Any]] = []
    unclassified: list[dict[str, Any]] = []
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        relative = path.relative_to(root)
        parts = relative.parts
        split = next((part.lower() for part in parts if part.lower() in SPLITS), None)
        class_name = next((part.lower() for part in parts if part.lower() in LABELS), None)
        generator = next((part for part in parts if part.lower() in SPLITS), "").strip()
        generator = str(relative.parent.parts[0]) if len(relative.parts) >= 4 else "unknown"
        row = inspect_image(path)
        row.update(relative_path=str(relative), generator=generator, split=split or "unknown",
                   class_name=class_name or "unknown", label=LABELS.get(class_name))
        rows.append(row)
        if split is None or class_name is None:
            unclassified.append({"path": str(relative), "reason": "could_not_infer_split_or_class_from_parent_directories"})
    return rows, unclassified


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect an extracted GenImage tree without modifying source images.")
    parser.add_argument("--data-root", type=Path, default=os.environ.get("GENIMAGE_ROOT"),
                        help="Dataset root (or set GENIMAGE_ROOT). Required; never guessed.")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/inspection"))
    args = parser.parse_args()
    if args.data_root is None:
        parser.error("provide --data-root or set GENIMAGE_ROOT")

    root = args.data_root.expanduser().resolve()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    rows, unclassified = discover(root)
    write_csv(out / "files.csv", rows)
    write_csv(out / "invalid_files.csv", [r for r in rows if r["status"] != "ok"])
    write_csv(out / "unclassified_files.csv", unclassified)

    class_counts = Counter((r["generator"], r["split"], r["class_name"], r["status"]) for r in rows)
    dims = Counter((r["width"], r["height"]) for r in rows if r["status"] == "ok")
    modes = Counter(r["mode"] for r in rows if r["status"] == "ok")
    formats = Counter(r["format"] for r in rows if r["status"] == "ok")
    hashes: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        if row["sha256"]:
            hashes[row["sha256"]].append(row["relative_path"])
    duplicate_groups = [paths for paths in hashes.values() if len(paths) > 1]
    summary = {
        "dataset_root": str(root), "total_files": len(rows),
        "status_counts": dict(Counter(r["status"] for r in rows)),
        "class_counts_by_generator_split_class_status": [
            {"generator": g, "split": s, "class": c, "status": st, "count": n}
            for (g, s, c, st), n in sorted(class_counts.items())],
        "dimensions_top_20": [{"width": w, "height": h, "count": n} for (w, h), n in dims.most_common(20)],
        "modes": dict(modes), "formats": dict(formats),
        "exact_duplicate_group_count": len(duplicate_groups),
        "exact_duplicate_files": sum(len(group) for group in duplicate_groups),
        "exact_duplicate_groups": duplicate_groups,
        "label_mapping": LABELS,
        "notes": ["Source images were not modified.", "Unsupported extensions and invalid images remain listed; no files were silently discarded."],
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps({"root": str(root), "total_files": len(rows), "statuses": summary["status_counts"],
                      "outputs": str(out.resolve())}, indent=2))


if __name__ == "__main__":
    main()
