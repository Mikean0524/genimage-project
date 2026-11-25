import io
import json
import sys
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from web_trace import parse_web_detection, search_image
from serpapi_trace import parse_exact_matches, prepare_image, search_image as serpapi_search_image, MAX_UPLOAD_BYTES
from app import Handler


class TraceTests(unittest.TestCase):
    def test_serpapi_prepares_small_image_and_only_returns_exact_matches(self):
        buffer = io.BytesIO()
        Image.new("RGB", (1600, 1200), "red").save(buffer, format="PNG")
        prepared = prepare_image(buffer.getvalue())
        self.assertLessEqual(len(prepared), MAX_UPLOAD_BYTES)
        with Image.open(io.BytesIO(prepared)) as image:
            self.assertEqual(image.format, "JPEG")
        results = parse_exact_matches({"exact_matches": [
            {"link": "https://example.org/post", "title": "A post"},
            {"link": "javascript:alert(1)"},
            {"link": "https://example.org/post"},
        ], "visual_matches": [{"link": "https://example.org/lookalike"}]})
        self.assertEqual([item["url"] for item in results], ["https://example.org/post"])

    def test_serpapi_uploads_then_searches_with_image_id(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        calls = []
        def opener(request, timeout):
            calls.append(request)
            self.assertEqual(timeout, 30)
            if len(calls) == 1:
                self.assertEqual(request.full_url, "https://serpapi.com/image")
                self.assertIn(b'name="api_key"', request.data)
                self.assertIn(b"test-key", request.data)
                self.assertIn(b"\xff\xd8", request.data)
                return Response(b'{"image_id":"upload-123"}')
            self.assertIn("engine=google_lens", request.full_url)
            self.assertIn("type=exact_matches", request.full_url)
            self.assertIn("image_id=upload-123", request.full_url)
            return Response(b'{"exact_matches":[{"link":"https://example.org/post"}]}')

        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(buffer, format="PNG")
        result = serpapi_search_image(buffer.getvalue(), "test-key", opener)
        self.assertEqual(result["matches"][0]["kind"], "exact")
        self.assertEqual(len(calls), 2)

    def test_serpapi_no_results_is_empty_search(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        calls = 0
        def opener(request, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                return Response(b'{"image_id":"upload-123"}')
            return Response(b'{"error":"Google Lens hasn\'t returned any results for this query."}')

        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(buffer, format="PNG")
        self.assertEqual(serpapi_search_image(buffer.getvalue(), "test-key", opener)["matches"], [])

    def test_only_matching_pages_and_images_are_returned(self):
        payload = {"responses": [{"webDetection": {
            "pagesWithMatchingImages": [
                {"url": "https://example.org/page", "pageTitle": "Example",
                 "fullMatchingImages": [{"url": "https://example.org/image.jpg"}]},
                {"url": "https://example.org/crop", "partialMatchingImages": [{"url": "https://example.org/crop.jpg"}]},
                {"url": "https://example.org/similar"}],
            "fullMatchingImages": [{"url": "https://example.org/image.jpg"}],
            "visuallySimilarImages": [{"url": "https://example.org/unrelated.jpg"}],
            "partialMatchingImages": [{"url": "javascript:alert(1)"}],
        }}]}
        matches = parse_web_detection(payload)
        self.assertEqual([match["kind"] for match in matches], ["full", "full", "partial"])
        self.assertNotIn("https://example.org/unrelated.jpg", [match["url"] for match in matches])

    def test_request_uses_image_bytes_and_web_detection(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *_):
                self.close()

        def opener(request, timeout):
            self.assertEqual(timeout, 20)
            self.assertIn("key=test-key", request.full_url)
            body = json.loads(request.data)
            self.assertEqual(body["requests"][0]["features"][0]["type"], "WEB_DETECTION")
            self.assertEqual(body["requests"][0]["image"]["content"], "aW1hZ2U=")
            return Response(b'{"responses":[{"webDetection":{}}]}')

        result = search_image(b"image", "test-key", opener)
        self.assertEqual(result["matches"], [])

    def test_http_route_requires_configuration_and_returns_provider_result(self):
        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), "red").save(buffer, format="PNG")
        image = buffer.getvalue()
        Handler.vision_api_key = ""
        Handler.serpapi_api_key = ""
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        endpoint = f"http://127.0.0.1:{server.server_port}/api/trace"
        try:
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(endpoint, data=image, method="POST"), timeout=3)
            self.assertEqual(caught.exception.code, 503)
            Handler.vision_api_key = "test-key"
            expected = {"provider": "test", "searched_at": "2026-01-01T00:00:00Z", "matches": []}
            with patch("web_trace.search_image", return_value=expected) as search:
                with urlopen(Request(endpoint, data=image, method="POST"), timeout=3) as response:
                    self.assertEqual(json.load(response), expected)
                search.assert_called_once_with(image, "test-key")
            Handler.serpapi_api_key = "free-key"
            with patch("serpapi_trace.search_image", return_value=expected) as search:
                with urlopen(Request(endpoint, data=image, method="POST"), timeout=3) as response:
                    self.assertEqual(json.load(response), expected)
                search.assert_called_once_with(image, "free-key")
        finally:
            server.shutdown()
            server.server_close()
            Handler.vision_api_key = ""
            Handler.serpapi_api_key = ""


if __name__ == "__main__":
    unittest.main()
