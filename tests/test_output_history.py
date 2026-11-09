"""v0.9 output-history delivery and integration contracts.

The interactive flow is additionally exercised with Chromium using an offline
HTML/network bridge because managed Chromium forbids localhost navigation here.
"""
from pathlib import Path
import re
from fastapi.testclient import TestClient
from app.main import app

ROOT = Path(__file__).parents[1]
CLIENT = TestClient(app)


def test_version_and_new_assets_are_served():
    assert CLIENT.get('/api/health').json()['version']=='0.9.0'
    for name in ('output_history.js', 'output_history.css'):
        response=CLIENT.get('/static/'+name)
        assert response.status_code==200, name
        assert len(response.content)>500
    assert CLIENT.get('/static/../../package-lock.json').status_code in (400, 404, 422)


def test_output_viewer_has_select_filter_export_and_clear_controls():
    html=CLIENT.get('/').text
    assert 'v0.9' in html
    for marker in ('output-history-list','output-preview','output-search','output-type',
                   'output-html','output-csv','output-recipe','output-clear'):
        assert f'id="{marker}"' in html
    assert 'sandbox title="Safely rendered statistical report"' in html
    assert '/static/output_history.js' in html


def test_history_backup_is_explicit_opt_in():
    html=CLIENT.get('/').text
    assert '<input type="checkbox" id="project-include-history"/>' in html
    assert 'OFF by default' in html
    js=CLIENT.get('/static/projects.js').text
    assert "$('project-include-history').checked ? window.StatLabOutput.capture() : []" in js
    assert "window.StatLabOutput.restore(verified.output_history,verified.title)" in js


def test_archived_report_html_is_sandboxed_and_scripts_rejected():
    js=CLIENT.get('/static/output_history.js').text
    assert "const MAX_RUNS=30" in js
    assert "const MAX_SAVE=20" in js
    assert "status:'archived'" in js
    assert 'frame.srcdoc=csp+row.html' in js
    assert 'default-src' in js and 'connect-src' in js and "'none'" in js
    assert 'javascript:' in js and 'Saved HTML report contains executable' in js
    assert 'removeAttribute(\'srcdoc\')' in js


def test_case_and_frequency_paths_feed_unified_history_without_recreating_rows():
    app_js=CLIENT.get('/static/app.js').text
    frequency_js=CLIENT.get('/static/frequency.js').text
    chapter_js=CLIENT.get('/static/chapter_four.js').text
    history_js=CLIENT.get('/static/output_history.js').text
    assert "new CustomEvent('statlab:case-result'" in app_js
    assert "new CustomEvent('statlab:chapter-result'" in chapter_js
    assert "new CustomEvent('statlab:frequency-results'" in frequency_js
    assert 'No respondent-level records' in frequency_js
    assert 'statlab:frequency-results' in history_js
    assert 'statlab:case-result' in history_js
    assert 'statlab:chapter-result' in history_js
    assert 'statlab:case-stale' in history_js
    assert re.search(r"const MAX_(?:HTML|CSV|RECIPE)=\d+",history_js)
