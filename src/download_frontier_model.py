"""Download and verify the frontier detector used by the local server."""
from __future__ import annotations

import hashlib
from pathlib import Path

from huggingface_hub import hf_hub_download

REPO = "Thermostatic/community-forensics-frontier-detector-2026-08"
FILENAME = "community_forensics_frontier_fp16.onnx"
EXPECTED_SHA256 = "d75791ba2fa59146025d342cfaafa9ddeab24af117642a94f752ee4c1619375d"
DESTINATION = Path(__file__).resolve().parent.parent / "outputs/models/frontier"


def main():
    downloaded = Path(hf_hub_download(REPO, FILENAME, local_dir=DESTINATION))
    hasher = hashlib.sha256()
    with downloaded.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    digest = hasher.hexdigest()
    if digest != EXPECTED_SHA256:
        raise RuntimeError(f"Unexpected model SHA-256: {digest}")
    print(f"Verified {downloaded} ({digest})")


if __name__ == "__main__":
    main()
