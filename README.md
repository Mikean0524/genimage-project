# GenImage project

## Run the image detector

From the repository root, install the server requirements, download the verified frontier model, and start the local server:

```powershell
python -m pip install -r requirements-server.txt
python src/download_frontier_model.py
python server/app.py
```

Open http://127.0.0.1:8000. The old project-trained ResNet remains available with `python server/app.py --detector resnet`. The frontier model uses a fixed 0.65 threshold and is a screening tool, not proof of image origin. See [server/README.md](server/README.md) for its measured results and source.

## Original GenImage experiment

Read [the project plan](docs/PROJECT_PLAN.md) before running stages. Task 1 inspection needs an explicit extracted dataset root:

```powershell
python -m pip install -r requirements-inspection.txt
python src/inspect_genimage.py --data-root "D:\path\to\extracted\GenImage"
```

Alternatively set `GENIMAGE_ROOT`. The inspection command writes inventory CSVs and a summary under `outputs/inspection/`; it does not modify source images. Proceed to preprocessing/model stages only after reviewing the reported directory structure, counts, invalid files, and duplicate groups.

Storage constraint: the full GenImage benchmark is far above the requested 1.5 GB ceiling. This project will use a size-capped sample and retain its provenance/split metadata; it will not fetch a large archive and discard most of it. Verify each source download size before starting.

## Downloaded training/evaluation sample

A curated 9,750-record GenImage-derived sample is materialized under `data/genimage_sample/` as ordinary image files, grouped into `train`, `val`, and `test`, each with `real` and `ai` class folders. Images are preserved in their original encoded formats (JPEG and PNG); no random augmentations or image re-encoding were applied.

The sample came from four train Parquet shards and one validation Parquet shard of [TheKernel01/Tiny-GenImage](https://huggingface.co/datasets/TheKernel01/Tiny-GenImage). This is a curated GenImage-derived mirror, not the complete official benchmark. Its separate `test` folder is the selected mirror validation shard; `train` was split deterministically into 80% training and 20% model-validation by image hash. This is not the original paper's official test protocol. One exact duplicate was excluded and listed in `data/genimage_sample/manifest.csv`; no unreadable records were found. The selected sample contains 9,749 unique valid images: 6,406 train, 1,593 val, and 1,750 test. AI-generated is label 1; real is label 0.

The image files plus manifests currently occupy about 2.32 GB (2,320,339,999 bytes), below the 3 GB dataset cap. Original Parquet shard files were removed one by one only after each shard's images had been extracted and verified, so the working data keeps one representation. Source and split decisions are recorded in `data/genimage_sample/summary.json` and `manifest.csv`.

To re-run the bounded materialization before extraction, use:

```powershell
python -m pip install -r requirements-data.txt
python src/materialize_parquet_sample.py --plan-only
```

After the initial materialization the Parquet staging directory is empty; the extracted files are ready for model loaders using `ImageFolder` or the manifest.
The parquet source shards have already been materialized and removed from `data/genimage_tiny_sample/` to preserve the storage cap. The image records and their exact source metadata remain in `data/genimage_sample/`. Re-running materialization requires restoring the same five source shards first; `--plan-only` checks the cap before extraction.
