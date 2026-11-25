"""Reverse-image lookup through Google Cloud Vision Web Detection.

Only actual full or partial image matches are returned. Vision does not report
first-seen dates, traffic estimates, or a verified original source.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

ENDPOINT = "https://vision.googleapis.com/v1/images:annotate"


class TraceError(Exception):
    pass


def _web_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    return value if parsed.scheme in {"http", "https"} and parsed.netloc else None


def parse_web_detection(payload):
    """Return only matching pages and images; omit visually similar results."""
    responses = payload.get("responses") or []
    if not responses:
        raise TraceError("The image search returned no response.")
    response = responses[0]
    if response.get("error"):
        raise TraceError(response["error"].get("message", "The image search failed."))
    detection = response.get("webDetection") or {}
    matches, seen = [], set()

    def add(url, kind, title="", image_url=None):
        url = _web_url(url)
        if not url or url in seen:
            return
        seen.add(url)
        matches.append({"url": url, "kind": kind, "title": str(title or "")[:250],
                        "image_url": _web_url(image_url)})

    for page in detection.get("pagesWithMatchingImages") or []:
        kind = "full" if page.get("fullMatchingImages") else "partial" if page.get("partialMatchingImages") else None
        if kind:
            images = page.get("fullMatchingImages") or page.get("partialMatchingImages") or []
            add(page.get("url"), kind, page.get("pageTitle"), images[0].get("url") if images else None)
    for image in detection.get("fullMatchingImages") or []:
        add(image.get("url"), "full")
    for image in detection.get("partialMatchingImages") or []:
        add(image.get("url"), "partial")
    matches.sort(key=lambda item: (item["kind"] != "full", item["url"]))
    return matches[:50]


def search_image(data: bytes, api_key: str, opener=urlopen):
    if not api_key:
        raise TraceError("Source tracing is not configured. Set GOOGLE_CLOUD_VISION_API_KEY and restart the server.")
    body = json.dumps({"requests": [{"image": {"content": base64.b64encode(data).decode("ascii")},
                                      "features": [{"type": "WEB_DETECTION", "maxResults": 30}]}]}).encode("utf-8")
    request = Request(f"{ENDPOINT}?{urlencode({'key': api_key})}", data=body,
                      headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
    try:
        with opener(request, timeout=20) as response:
            payload = json.load(response)
    except HTTPError as error:
        raise TraceError(f"Google Vision returned HTTP {error.code}. Check the API key, billing, and Vision API access.") from error
    except (URLError, TimeoutError) as error:
        raise TraceError("Could not reach Google Vision. Try again when the connection is available.") from error
    except (ValueError, OSError) as error:
        raise TraceError("The image search returned an unreadable response.") from error
    return {"provider": "Google Cloud Vision Web Detection",
            "searched_at": datetime.now(timezone.utc).isoformat(),
            "matches": parse_web_detection(payload)}
