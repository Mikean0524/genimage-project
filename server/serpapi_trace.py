"""Google Lens exact-match search through SerpApi's free tier."""
from __future__ import annotations

import io
import json
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageOps, UnidentifiedImageError

from web_trace import TraceError, _web_url

UPLOAD_URL = "https://serpapi.com/image"
SEARCH_URL = "https://serpapi.com/search.json"
MAX_UPLOAD_BYTES = 500_000


def prepare_image(data):
    """Make a JPEG that fits the provider's 500 KB upload limit."""
    try:
        with Image.open(io.BytesIO(data)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise TraceError("Could not prepare this image for Google Lens.") from error
    for max_side in (1200, 900, 700, 500, 350):
        copy = image.copy()
        copy.thumbnail((max_side, max_side))
        for quality in (85, 70, 55):
            output = io.BytesIO()
            copy.save(output, format="JPEG", quality=quality, optimize=True)
            if output.tell() <= MAX_UPLOAD_BYTES:
                return output.getvalue()
    raise TraceError("Could not reduce this image below the Google Lens upload limit.")


def parse_exact_matches(payload):
    if payload.get("error"):
        raise TraceError(str(payload["error"])[:300])
    matches, seen = [], set()
    for item in payload.get("exact_matches") or []:
        if not isinstance(item, dict):
            continue
        url = _web_url(item.get("link"))
        if not url or url in seen:
            continue
        seen.add(url)
        matches.append({"url": url, "kind": "exact", "title": str(item.get("title") or "")[:250],
                        "image_url": _web_url(item.get("thumbnail"))})
    return matches[:50]


def _read_json(request, opener):
    try:
        with opener(request, timeout=30) as response:
            payload = json.load(response)
    except HTTPError as error:
        raise TraceError(f"SerpApi returned HTTP {error.code}. Check your API key and free search quota.") from error
    except (URLError, TimeoutError) as error:
        raise TraceError("Could not reach SerpApi. Try again when the connection is available.") from error
    except (ValueError, OSError) as error:
        raise TraceError("SerpApi returned an unreadable response.") from error
    if not isinstance(payload, dict):
        raise TraceError("SerpApi returned an unexpected response.")
    if payload.get("error"):
        raise TraceError(str(payload["error"])[:300])
    return payload


def search_image(data: bytes, api_key: str, opener=urlopen):
    if not api_key:
        raise TraceError("Set SERPAPI_API_KEY and restart the server.")
    image = prepare_image(data)
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"api_key\"\r\n\r\n{api_key}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"search.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n"
    ).encode("utf-8") + image + f"\r\n--{boundary}--\r\n".encode("ascii")
    upload = Request(UPLOAD_URL, data=body,
                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    image_id = _read_json(upload, opener).get("image_id")
    if not isinstance(image_id, str) or not image_id:
        raise TraceError("SerpApi did not return an image ID.")
    query = urlencode({"engine": "google_lens", "type": "exact_matches", "image_id": image_id,
                       "api_key": api_key})
    try:
        results = _read_json(Request(f"{SEARCH_URL}?{query}"), opener)
    except TraceError as error:
        if str(error) == "Google Lens hasn't returned any results for this query.":
            results = {"exact_matches": []}
        else:
            raise
    return {"provider": "Google Lens via SerpApi", "searched_at": datetime.now(timezone.utc).isoformat(),
            "matches": parse_exact_matches(results)}
