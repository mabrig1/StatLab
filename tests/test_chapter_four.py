"""Guard rails for objective-aligned academic writing from frequency marginals."""
from io import BytesIO, StringIO

from docx import Document
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.aggregate_descriptives import analyze_frequencies
from app.chapter_four import (
    ChapterFourError, build_chapter_four, chapter_four_csv,
    chapter_four_docx, chapter_four_html,
)
from app.main import app, sessions

FIVE = ('Item 5 (5-point scale):\nStrongly Disagree = 30\nDisagree = 23\n'
        'Neutral = 20\nAgree = 45\nStrongly Agree = 35\nTotal N = 153')
TWO = 'Item 1: 1=10, 2=20, 3=15, 4=30, 5=25\nItem 2 [reverse]: 1=12, 2=8, 3=10, 4=20, 5=40'


def test_single_item_verified_values_default_source_no_invented_data():
    report = build_chapter_four(analyze_frequencies(text=FIVE))
    item = report['groups'][0]['items'][0]
    assert item['n'] == 153
    assert item['mean'] == pytest.approx(491/153)
    assert item['sd'] == pytest.approx(1.4539130266612537)
    assert item['top_frequency'] == 45
    assert item['top_percentage'] == pytest.approx(100*45/153)
    assert item['table_number'] == '4.1'
    assert report['groups'][0]['objective_index'] is None
    assert 'not independently verified' in report['source']
    html = chapter_four_html(report)
    assert 'Source:</b> User-supplied frequency counts' in html
    assert 'Field Survey' not in html
    assert '100.00%' in html
    assert '<script' not in html
    assert '4.5 Limitations' in html
    for impossible in ['p = 0.0', 'significant association', 'R-squared']:
        assert impossible not in html


def test_multiple_objectives_and_unassigned_items_are_explicit():
    a = analyze_frequencies(text=TWO + '\nItem 3: 1=3, 2=4, 3=6, 4=7, 5=10')
    report = build_chapter_four(
        a, research_title='Survey Research',
        objectives=['Measure service access', 'Describe satisfaction'],
        item_objectives={'Item 1': 2, 'Item 2': 1},
        source_label='Original field records, 2026')
    assert [g['objective_index'] for g in report['groups']] == [1, 2, None]
    assert [g['items'][0]['name'] for g in report['groups']] == ['Item 2','Item 1','Item 3']
    assert [x['table_number'] for g in report['groups'] for x in g['items']] == ['4.1', '4.2', '4.3']
    assert report['summary'][0]['objective'] == 'Objective 2'
    assert report['summary'][2]['objective'] == 'Unassigned'
    assert 'respondent-level composite scores' in chapter_four_html(report)
    assert report['groups'][0]['items'][0]['reversed'] is True
    assert report['groups'][0]['items'][0]['rows'][0]['category'] == 'Strongly Disagree'
    assert report['source'] == 'Original field records, 2026'


def test_differing_n_and_metadata_not_used_as_denominator():
    a = analyze_frequencies(text=TWO, sample_size=999, population_size=2000)
    report = build_chapter_four(a)
    assert '100' in report['coverage'] and '90' in report['coverage']
    assert '999' in report['coverage']
    assert 'No questionnaire return rate can be calculated' in report['coverage']
    assert report['summary'][0]['n'] == 100
    assert report['summary'][1]['n'] == 90


def test_single_valid_frequency_has_no_sample_sd():
    report = build_chapter_four(analyze_frequencies(items={'Item 1': {'1': 1}}))
    assert report['summary'][0]['sd'] is None
    assert 'Not defined' in report['groups'][0]['items'][0]['discussion']
    assert 'Not defined' in chapter_four_html(report)


def test_html_escaping_and_formula_safe_csv():
    source = {'=IMPORTXML("https://bad.invalid")': {'1': 1, '5': 2}}
    a = analyze_frequencies(items=source)
    report = build_chapter_four(a, research_title='<img src=x onerror=alert(1)>',
        objectives=['<script>alert(2)</script>'],
        item_objectives={'=IMPORTXML("https://bad.invalid")': 1},
        source_label='<b>Field Survey</b>')
    html = chapter_four_html(report)
    assert '<img' not in html and '<script' not in html
    assert '&lt;img' in html and '&lt;script' in html
    assert '&lt;b&gt;Field Survey&lt;/b&gt;' in html
    csv_text = chapter_four_csv(report)
    assert "'=IMPORTXML" in csv_text
    frame = pd.read_csv(StringIO(csv_text))
    assert frame.iloc[0]['Item'].startswith("'=IMPORTXML")


@pytest.mark.parametrize('kwargs', [
    {'objectives':['']},
    {'objectives':['x']*13},
    {'objectives':['x'], 'item_objectives':{'Unknown item':1}},
    {'objectives':['x'], 'item_objectives':{'Item 5':0}},
    {'objectives':['x'], 'item_objectives':{'Item 5':2}},
    {'objectives':['x'], 'item_objectives':{'Item 5':True}},
    {'research_title':'a'*241},
    {'source_label':'a'*201},
])
def test_invalid_report_metadata_rejected(kwargs):
    with pytest.raises(ChapterFourError):
        build_chapter_four(analyze_frequencies(text=FIVE),**kwargs)


def test_docx_is_editable_and_contains_actual_counts():
    report = build_chapter_four(analyze_frequencies(text=FIVE), objectives=['Describe attitudes'],
                               item_objectives={'Item 5':1})
    doc = Document(BytesIO(chapter_four_docx(report)))
    contents = '\n'.join(p.text for p in doc.paragraphs)
    assert '4.4 Discussion' in contents
    assert 'No individual respondent records' in contents
    assert 'Field Survey, 2026' not in contents
    assert len(doc.tables) == 1
    assert [c.text for c in doc.tables[0].rows[4].cells] == ['Agree','45','29.41%']
    assert [c.text for c in doc.tables[0].rows[-1].cells] == ['Total','153','100.00%']


def test_api_recomputes_counts_and_exports_docx_without_sessions():
    client=TestClient(app)
    before=set(sessions)
    payload={'analysis':{'text':FIVE},'research_title':'Sample Study',
             'objectives':['Describe participation'], 'item_objectives':{'Item 5':1}}
    response=client.post('/api/frequency-only/chapter-four',json=payload)
    assert response.status_code == 200, response.text
    data=response.json()
    assert data['report']['summary'][0]['n'] == 153
    assert '4.1' in data['html']
    assert 'Item 5' in data['csv']
    doc_response=client.post('/api/frequency-only/chapter-four.docx',json=payload)
    assert doc_response.status_code == 200, doc_response.text
    assert doc_response.content.startswith(b'PK')
    assert Document(BytesIO(doc_response.content)).tables[0].rows[4].cells[1].text == '45'
    assert set(sessions) == before


def test_api_rejects_invalid_objectives_and_bad_total_without_creating_report():
    client=TestClient(app)
    payload={'analysis':{'text':FIVE}, 'objectives':['A'], 'item_objectives':{'Item 5':3}}
    assert client.post('/api/frequency-only/chapter-four',json=payload).status_code == 422
    payload['item_objectives']={'Item 5':1}
    payload['analysis']['text']=FIVE.replace('Total N = 153','Total N = 200')
    assert client.post('/api/frequency-only/chapter-four.docx',json=payload).status_code == 422


def test_word_and_html_report_consistently_label_source():
    a=analyze_frequencies(text=FIVE,sd_method='population')
    r=build_chapter_four(a,source_label='Field Survey, 2026')
    html=chapter_four_html(r)
    doc=Document(BytesIO(chapter_four_docx(r)))
    assert 'Field Survey, 2026' in html
    assert 'Field Survey, 2026' in '\n'.join(p.text for p in doc.paragraphs)
    assert 'Population SD' in html
