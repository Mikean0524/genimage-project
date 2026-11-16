# GenImage-derived sample

Source: [TheKernel01/Tiny-GenImage](https://huggingface.co/datasets/TheKernel01/Tiny-GenImage), curated mirror of GenImage, licensed by that mirror under CC-BY-NC-SA-4.0. See the official GenImage repository for the original benchmark and its dataset terms: https://github.com/GenImage-Dataset/GenImage

This working subset uses four source `train` Parquet shards and one source `validation` shard. The 8,000 source train records were deterministically partitioned by image SHA-256 into `train` and `val` (80/20). The selected 1,750-record source validation shard is the held-out `test` partition in this project; it is not the official paper test set. Label mapping: `real=0`, `ai=1`. Images are stored as encoded in their actual format (JPEG or PNG) without re-encoding.

There are 9,749 valid unique images after excluding one exact duplicate and zero invalid records. Counts: train 6,406 (3,220 real / 3,186 AI), val 1,593 (779 real / 814 AI), test 1,750 (875 real / 875 AI). Total files including manifest and summary: 2,320,339,999 bytes. See `manifest.csv` and `summary.json` for the record-level inventory and scan details.
