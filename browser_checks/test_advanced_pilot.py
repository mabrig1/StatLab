"""Real Chromium browser checks for the StatLab *static* advanced pilot.

All network calls stay on a local HTTP server; API requests are mocked. Nothing
is deployed or transmitted to Cloudflare and no university records are used.
The genuine Cloudflare -> Python numerical integration is checked separately.
"""
from __future__ import annotations

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from playwright.sync_api import expect, sync_playwright

PUBLIC = Path(__file__).resolve().parents[1] / "cloudflare" / "public"
TEST_RESULT = {
    "title": "ARIMA synthetic pilot finding",
    "method": "Synthetic browser test only",
    "narrative": "Example validation result. Not a university field study.",
    "warnings": ["Never publish this synthetic result as empirical evidence."],
    "tables": [
        {"title": "Three-step forecast", "columns": ["Period", "Value"],
         "rows": [["T+1", 14.6], ["T+2", 14.3], ["T+3", 14.1]]}
    ],
}


@pytest.fixture(scope="module")
def site():
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    handler = partial(QuietHandler, directory=str(PUBLIC))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/advanced.html"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


@pytest.fixture(scope="module")
def chromium():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            yield browser
        finally:
            browser.close()


def visit(browser, site, *, ready=False, mobile=False):
    context = browser.new_context(
        viewport={"width": 360 if mobile else 1280, "height": 780},
        device_scale_factor=2 if mobile else 1,
        is_mobile=mobile,
        has_touch=mobile,
        accept_downloads=True,
    )
    page = context.new_page()
    seen = []

    def status(route):
        seen.append(("status", None))
        route.fulfill(status=200, content_type="application/json",
                      body='{"available":' + ("true" if ready else "false") + "}")

    page.route("**/api/advanced/status", status)
    page.goto(site, wait_until="networkidle", timeout=20_000)
    return context, page, seen


def fake_model_result(route, seen):
    data = route.request.post_data_json
    seen.append(("run", data))
    route.fulfill(status=200, content_type="application/json",
                  body=__import__("json").dumps(TEST_RESULT))


def acknowledge(page):
    page.locator("#ordered").check()
    page.locator("#consent").check()


def test_disabled_pilot_is_safe_with_local_examples(chromium, site):
    context, page, seen = visit(chromium, site)
    try:
        assert "disabled" in page.locator("#availability").inner_text().lower()
        assert page.locator("#run").is_disabled()
        page.locator("#example-arima").click()
        assert "96 SYNTHETIC observations" in page.locator("#file-help").inner_text()
        assert page.locator("#mode").input_value() == "arima"
        assert page.locator("#column").input_value() == "1"
        assert page.locator("#time").input_value() == "0"
        assert page.locator("#consent").is_checked() is False
        page.locator("#example-garch").click()
        assert "320 SYNTHETIC observations" in page.locator("#file-help").inner_text()
        assert page.locator("#mode").input_value() == "garch"
        assert page.locator("#kind").input_value() == "prices"
        assert page.locator("#run").is_disabled()
        assert not any(kind == "run" for kind, _ in seen)
    finally:
        context.close()


def test_no_submission_without_consent_and_only_numeric_column_transferred(chromium, site):
    context, page, seen = visit(chromium, site, ready=True)
    try:
        page.route("**/api/advanced/run", lambda route: fake_model_result(route, seen))
        page.locator("#example-arima").click()
        assert page.locator("#run").is_enabled()
        page.locator("#run").click()
        assert "explicit consent" in page.locator("#error").inner_text()
        assert not any(kind == "run" for kind, _ in seen)
        acknowledge(page)
        page.locator("#steps").select_option("3")
        page.locator("#run").click()
        page.locator("#report-title").wait_for(state="visible")
        assert page.locator("#report-title").inner_text() == "ARIMA synthetic pilot finding"
        assert "Three-step forecast" in page.locator("#report-tables").inner_text()
        run = [data for kind, data in seen if kind == "run"]
        assert len(run) == 1
        assert set(run[0]) == {"mode", "steps", "values", "consent", "p", "d", "q"}
        assert run[0]["mode"] == "arima" and run[0]["consent"] is True
        assert len(run[0]["values"]) == 96
        assert all(isinstance(v, (int, float)) for v in run[0]["values"])
        assert all(k not in run[0] for k in ("month", "date", "filename", "identity", "dataset_id"))
    finally:
        context.close()


def test_consent_cleared_on_changing_method_and_dataset(chromium, site):
    context, page, seen = visit(chromium, site, ready=True)
    try:
        page.route("**/api/advanced/run", lambda route: fake_model_result(route, seen))
        page.locator("#example-arima").click()
        acknowledge(page)
        page.locator("#mode").select_option("garch")
        assert not page.locator("#ordered").is_checked()
        assert not page.locator("#consent").is_checked()
        page.locator("#example-garch").click()
        acknowledge(page)
        page.locator("#time").select_option("")
        assert not page.locator("#ordered").is_checked()
        assert not page.locator("#consent").is_checked()
        acknowledge(page)
        page.locator("#kind").select_option("returns_decimal")
        assert not page.locator("#consent").is_checked()
        assert not any(kind == "run" for kind, _ in seen)
    finally:
        context.close()


def test_bad_csv_chronology_blocks_compute_before_upload(chromium, site):
    context, page, seen = visit(chromium, site, ready=True)
    try:
        page.route("**/api/advanced/run", lambda route: fake_model_result(route, seen))
        rows = ["month,value"]
        for i in range(60):
            year = 2018 + i // 12
            month = 1 + i % 12
            if i == 17:  # Duplicate the next month and leave a gap.
                month += 1
            rows.append(f"{year}-{month:02d},{20 + i * .15:.3f}")
        page.locator("#file").set_input_files({
            "name": "SYNTHETIC_gapped.csv", "mimeType": "text/csv",
            "buffer": ("\n".join(rows) + "\n").encode("utf-8"),
        })
        assert "60 CSV observations" in page.locator("#file-help").inner_text()
        acknowledge(page)
        page.locator("#run").click()
        assert "strictly consecutive" in page.locator("#error").inner_text()
        assert not any(kind == "run" for kind, _ in seen)
    finally:
        context.close()


def test_output_is_escaped_and_json_download_works(chromium, site):
    context, page, seen = visit(chromium, site, ready=True)
    try:
        unsafe = '<img src=x onerror="window.evil=1">'
        result = dict(TEST_RESULT, title=unsafe, warnings=[unsafe])
        def mock_result(route):
            seen.append(("run", route.request.post_data_json))
            route.fulfill(status=200, content_type="application/json",
                          body=__import__("json").dumps(result))
        page.route("**/api/advanced/run", mock_result)
        page.locator("#example-arima").click()
        acknowledge(page)
        page.locator("#run").click()
        expect(page.locator("#report-title")).to_have_text(unsafe, timeout=5000)
        assert page.locator("img").count() == 0
        assert page.evaluate("window.evil") is None
        with page.expect_download(timeout=5000) as download:
            page.locator("#export").click()
        assert download.value.suggested_filename == "statlab-advanced-results.json"
    finally:
        context.close()


@pytest.mark.parametrize("size", [360, 768, 1280])
def test_student_mobile_tablet_desktop_layout(chromium, site, size):
    context = chromium.new_context(
        viewport={"width": size, "height": 800},
        device_scale_factor=1,
        is_mobile=size == 360,
    )
    page = context.new_page()
    try:
        page.route("**/api/advanced/status", lambda route: route.fulfill(
            status=200, content_type="application/json", body='{"available":false}'))
        page.goto(site, wait_until="networkidle")
        page.locator("#example-garch").click()
        assert page.locator("#column").is_visible()
        assert page.locator("#run").is_disabled()
        geometry = page.evaluate(
            "() => ({scroll:document.documentElement.scrollWidth, width:window.innerWidth})")
        assert geometry["scroll"] <= geometry["width"] + 1, geometry
    finally:
        context.close()


def test_offline_status_provides_explanation_without_data_transfer(chromium, site):
    context = chromium.new_context()
    page = context.new_page()
    traffic = []
    page.on("request", lambda request: traffic.append((request.method, request.url)))
    try:
        page.route("**/api/advanced/status", lambda route: route.abort("failed"))
        page.goto(site, wait_until="networkidle")
        assert "could not be verified" in page.locator("#availability").inner_text()
        assert page.locator("#run").is_disabled()
        page.locator("#example-arima").click()
        assert "SYNTHETIC" in page.locator("#file-help").inner_text()
        assert not any(method == "POST" for method, _ in traffic)
    finally:
        context.close()
