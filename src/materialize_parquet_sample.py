from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import pyarrow.parquet as pq
from PIL import Image, UnidentifiedImageError

LABEL_NAMES = {0: "real", 1: "ai"}
GENERATOR_NAMES = {
    0: "Real", 1: "ADM", 2: "BigGAN", 3: "GLIDE", 4: "Midjourney",
    5: "SD14", 6: "SD15", 7: "VQDM", 8: "Wukong",
}
IMAGE_FORMAT_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "BMP": ".bmp", "TIFF": ".tiff"}
MAX_DATASET_BYTES = 3_000_000_000
MANIFEST_RESERVE_BYTES = 20_000_000


@dataclass
class Record:
    source_file: str
    source_row: int
    source_split: str
    label: int | None
    generator_id: int | None
    generator: str
    image_bytes: int
    sha256: str
    width: int | None
    height: int | None
    mode: str
    image_format: str
    status: str
    reason: str
    output_split: str
    output_path: str
    keep: bool


def classify_split(source_split: str, digest: str) -> str:
    # The mirror has train and validation, but no separate test split. Use 20%
    # of its train images for model selection and preserve its validation split
    # as a final held-out evaluation partition (called test in output folders).
    if source_split == "validation":
        return "test"
    return "val" if int(digest[:8], 16) % 5 == 0 else "train"


def safe_format(raw: bytes) -> tuple[str, str, int, int, str]:
    with Image.open(BytesIO(raw)) as image:
        image.verify()
    with Image.open(BytesIO(raw)) as image:
        image_format = (image.format or "").upper()
        extension = IMAGE_FORMAT_EXTENSIONS.get(image_format)
        if extension is None:
            raise ValueError(f"unsupported decoded image format: {image_format or 'unknown'}")
        return image_format, extension, image.width, image.height, image.mode


def inspect_sources(source_dir: Path) -> tuple[list[Path], list[Record], dict[str, Any]]:
    shards = sorted(source_dir.glob("*.parquet"), key=lambda p: (p.name.startswith("validation"), p.name))
    if not shards:
        raise FileNotFoundError(f"No parquet shards found in {source_dir}")

    seen_hashes: dict[str, tuple[int, str]] = {}
    records: list[Record] = []
    shard_expected_bytes: dict[str, int] = defaultdict(int)
    shard_unique_rows: Counter[str] = Counter()
    classes: Counter[tuple[str, int]] = Counter()
    generators: Counter[tuple[str, int]] = Counter()
    dimensions: Counter[tuple[int, int]] = Counter()
    modes: Counter[str] = Counter()
    formats: Counter[str] = Counter()
    invalid_records = 0
    duplicate_records = 0
    duplicate_label_conflicts = 0

    for shard in shards:
        source_split = "validation" if shard.name.lower().startswith("validation-") else "train"
        row_number = 0
        parquet = pq.ParquetFile(shard)
        for batch in parquet.iter_batches(batch_size=64, columns=["image", "label", "generator"]):
            for row in batch.to_pylist():
                row_number += 1
                image_struct = row.get("image") or {}
                raw = image_struct.get("bytes")
                label_value = row.get("label")
                generator_id = row.get("generator")
                label = int(label_value) if label_value is not None else None
                generator = GENERATOR_NAMES.get(int(generator_id), f"unknown_{generator_id}") if generator_id is not None else "unknown"
                digest = hashlib.sha256(raw).hexdigest() if raw else ""
                output_split = classify_split(source_split, digest) if digest else "invalid"
                output_path = ""
                status, reason = "ok", ""
                image_format, extension, width, height, mode = "", "", None, None, ""

                if not raw:
                    status, reason = "invalid", "missing_encoded_image_bytes"
                else:
                    try:
                        image_format, extension, width, height, mode = safe_format(raw)
                    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
                        status, reason = "invalid", f"{type(exc).__name__}: {exc}"

                if label not in LABEL_NAMES:
                    status, reason = "invalid", f"unknown_binary_label:{label}"
                if status == "ok":
                    prior = seen_hashes.get(digest)
                    keep = prior is None
                    if prior is not None:
                        duplicate_records += 1
                        if prior[0] != label:
                            duplicate_label_conflicts += 1
                        status, reason = "duplicate", f"exact_duplicate_of_row_{prior[1]}"
                    else:
                        seen_hashes[digest] = (label, row_number)
                        output_path = f"{output_split}/{LABEL_NAMES[label]}/{digest}.{extension.lstrip('.')}"
                        shard_expected_bytes[shard.name] += len(raw)
                        shard_unique_rows[shard.name] += 1
                        classes[(output_split, label)] += 1
                        if generator_id is not None:
                            generators[(generator, int(generator_id))] += 1
                        dimensions[(width, height)] += 1
                        modes[mode] += 1
                        formats[image_format] += 1
                else:
                    keep = False
                    invalid_records += 1

                records.append(Record(
                    source_file=shard.name, source_row=row_number, source_split=source_split,
                    label=label, generator_id=int(generator_id) if generator_id is not None else None,
                    generator=generator, image_bytes=len(raw) if raw else 0, sha256=digest,
                    width=width, height=height, mode=mode, image_format=image_format,
                    status=status, reason=reason, output_split=output_split,
                    output_path=output_path, keep=keep,
                ))

    source_sizes = {p.name: p.stat().st_size for p in shards}
    source_total = sum(source_sizes.values())
    extraction_total = sum(shard_expected_bytes.values())

    # With each shard removed after it is materialized, this computes the peak
    # dataset footprint at each step before any image files are written.
    remaining_sources = source_total
    prior_outputs = 0
    predicted_peak = source_total
    peak_steps: list[dict[str, int | str]] = []
    for shard in shards:
        expected = shard_expected_bytes[shard.name]
        peak = remaining_sources + prior_outputs + expected + MANIFEST_RESERVE_BYTES
        predicted_peak = max(predicted_peak, peak)
        peak_steps.append({"shard": shard.name, "peak_bytes": peak})
        remaining_sources -= source_sizes[shard.name]
        prior_outputs += expected

    split_label_counts = {
        split: {LABEL_NAMES[label]: classes[(split, label)] for label in sorted(LABEL_NAMES)}
        for split in ("train", "val", "test")
    }
    summary = {
        "source": "TheKernel01/Tiny-GenImage on Hugging Face (a curated GenImage-derived subset, not the complete official benchmark)",
        "source_url": "https://huggingface.co/datasets/TheKernel01/Tiny-GenImage",
        "source_license": "CC-BY-NC-SA-4.0 as stated by the mirror dataset card; verify original GenImage terms for any redistribution",
        "source_split_protocol": "source train shards deterministically split 80/20 into train/val; the selected source validation shard is preserved as the held-out test partition; this is not the official paper test set",
        "source_shard_count": len(shards),
        "source_shard_sizes_bytes": source_sizes,
        "source_bytes": source_total,
        "input_records": len(records),
        "valid_unique_records": sum(shard_unique_rows.values()),
        "invalid_records": invalid_records,
        "exact_duplicate_records_excluded": duplicate_records,
        "duplicate_label_conflicts": duplicate_label_conflicts,
        "extracted_image_payload_bytes": extraction_total,
        "predicted_peak_dataset_bytes_during_materialization": predicted_peak,
        "cap_bytes": MAX_DATASET_BYTES,
        "class_counts_by_output_split": split_label_counts,
        "generator_counts": [{"generator": gen, "generator_id": gid, "count": count} for (gen, gid), count in sorted(generators.items())],
        "dimensions": [{"width": w, "height": h, "count": count} for (w, h), count in dimensions.most_common()],
        "modes": dict(modes),
        "formats": dict(formats),
        "shard_extraction_bytes": dict(shard_expected_bytes),
        "predicted_peak_by_step": peak_steps,
        "notes": [
            "Encoded image bytes are preserved without re-encoding; actual image format determines the file extension.",
            "Exact duplicates are kept once and logged in the manifest.",
            "The mirror provides train and validation splits, not a separate test split.",
            "AI-generated is label 1; real is label 0.",
        ],
    }
    return shards, records, summary


def write_manifest(path: Path, records: list[Record]) -> None:
    fieldnames = list(Record.__dataclass_fields__)
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(asdict(record) for record in records)


def materialize(shards: list[Path], records: list[Record], output_dir: Path, cap_bytes: int, resume: bool) -> None:
    records_by_shard: dict[str, list[Record]] = defaultdict(list)
    for record in records:
        records_by_shard[record.source_file].append(record)

    for shard in shards:
        planned = records_by_shard[shard.name]
        parquet = pq.ParquetFile(shard)
        row_index = 0
        written = 0
        for batch in parquet.iter_batches(batch_size=64, columns=["image"]):
            for row in batch.to_pylist():
                row_index += 1
                plan = planned[row_index - 1]
                if not plan.keep:
                    continue
                raw = row["image"].get("bytes")
                if not raw or hashlib.sha256(raw).hexdigest() != plan.sha256:
                    raise RuntimeError(f"Source changed while extracting: {shard.name} row {row_index}")
                destination = output_dir / Path(plan.output_path)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    if not resume:
                        raise FileExistsError(f"Output image already exists: {destination}")
                    existing_hash = hashlib.sha256(destination.read_bytes()).hexdigest()
                    if existing_hash != plan.sha256:
                        raise RuntimeError(f"Existing output does not match source record: {destination}")
                else:
                    destination.write_bytes(raw)
                written += len(raw)
        expected = sum(record.image_bytes for record in planned if record.keep)
        if written != expected:
            raise RuntimeError(f"Byte count mismatch for {shard.name}: wrote {written}, expected {expected}")

        # Keep only one representation of the data at a time. Close the parquet
        # reader before removing its source file (required on Windows).
        parquet.close()
        shard.unlink()
        current_dataset_bytes = sum(p.stat().st_size for p in output_dir.rglob("*") if p.is_file())
        remaining_source_bytes = sum(p.stat().st_size for p in shards if p.exists())
        if current_dataset_bytes + remaining_source_bytes > cap_bytes:
            raise RuntimeError("Dataset storage cap exceeded during extraction")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract bounded GenImage-derived Parquet shards into labeled image files.")
    parser.add_argument("--source-dir", type=Path, default=Path("data/genimage_tiny_sample"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/genimage_sample"))
    parser.add_argument("--cap-bytes", type=int, default=MAX_DATASET_BYTES)
    parser.add_argument("--plan-only", action="store_true", help="Inspect and report storage before extracting.")
    parser.add_argument("--resume", action="store_true", help="Continue a previously interrupted materialization after verifying existing files.")
    args = parser.parse_args()

    source_dir = args.source_dir.resolve()
    output_dir = args.output_dir.resolve()
    if output_dir.exists() and any(output_dir.iterdir()) and not args.resume:
        raise FileExistsError(f"Output directory must be empty or absent: {output_dir}")

    shards, records, summary = inspect_sources(source_dir)
    if summary["predicted_peak_dataset_bytes_during_materialization"] > args.cap_bytes:
        raise RuntimeError(
            "Preflight predicts the cap would be exceeded: "
            f"{summary['predicted_peak_dataset_bytes_during_materialization']} > {args.cap_bytes} bytes"
        )
    for split, counts in summary["class_counts_by_output_split"].items():
        if not all(counts.values()):
            raise RuntimeError(f"Split {split} is missing a class: {counts}")

    if args.plan_only:
        print(json.dumps(summary, indent=2))
        return

    output_dir.mkdir(parents=True, exist_ok=True)
    materialize(shards, records, output_dir, args.cap_bytes, args.resume)
    write_manifest(output_dir / "manifest.csv", records)
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    final_image_bytes = sum(p.stat().st_size for p in output_dir.rglob("*") if p.is_file())
    if final_image_bytes > args.cap_bytes:
        raise RuntimeError(f"Final dataset exceeds cap: {final_image_bytes} > {args.cap_bytes}")
    print(json.dumps({"output_dir": str(output_dir), "final_bytes_including_manifests": final_image_bytes,
                      "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
