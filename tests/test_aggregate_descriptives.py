"""Reference checks for strict frequency-only (non-row-level) survey analysis."""
import math
from io import StringIO

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.aggregate_descriptives import (
    DEFAULT_LABELS, SummaryError, analyze_frequencies, parse_summary_input,
    summary_csv, summary_frame,
)
from app.main import app, sessions

EXAMPLE = """Item 5 (5-point scale):
Strongly Disagree = 30
Disagree = 23
Neutral = 20
Agree = 45
Strongly Agree = 35
Total N = 153"""
FREQ = {'Item 5': {'Strongly Disagree': 30, 'Disagree': 23, 'Neutral': 20,
                    'Agree': 45, 'Strongly Agree': 35}}


def test_fully_worked_example_sample_sd():
    result = analyze_frequencies(text=EXAMPLE, population_size=1000, sample_size=200)
    item = result['items'][0]
    assert item['n'] == 153
    assert item['mean'] == pytest.approx(491 / 153)
    assert item['sd'] == pytest.approx(1.4539130266612537)
    assert item['median'] == 4
    assert item['mode'] == '4'
    assert item['top_response'] == 'Agree'
    assert item['top_frequency'] == 45
    assert sum(row['frequency'] for row in item['table']) == 153
    assert sum(row['percentage'] for row in item['table']) == pytest.approx(100.0)
    assert item['formula']['denominator'] == 152
    assert result['metadata']['population_size'] == 1000
    assert result['metadata']['sample_size'] == 200
    assert result['metadata']['metadata_only'] is True
    assert not any(k in result for k in ('respondents', 'case_data', 'rows'))


def test_dictionary_matches_text_and_csv_tables():
    from_dict = analyze_frequencies(items=FREQ)['items'][0]
    csv_input = '''Item,Strongly Disagree,Disagree,Neutral,Agree,Strongly Agree,Total N
Item 5,30,23,20,45,35,153'''
    markdown_input = '''| Item | Strongly Disagree | Disagree | Neutral | Agree | Strongly Agree | Total N |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Item 5 | 30 | 23 | 20 | 45 | 35 | 153 |'''
    tidy_csv = '''Item,Response,Frequency
Item 5,Strongly Disagree,30
Item 5,Disagree,23
Item 5,Neutral,20
Item 5,Agree,45
Item 5,Strongly Agree,35'''
    inline = 'Item 5: 1=30, 2=23, 3=20, 4=45, 5=35, Total N=153'
    ordered = 'Item 5: 30,23,20,45,35'
    for input_text in (EXAMPLE, csv_input, markdown_input, tidy_csv, inline, ordered, str(FREQ)):
        item = analyze_frequencies(text=input_text)['items'][0]
        assert item['mean'] == pytest.approx(from_dict['mean'])
        assert item['sd'] == pytest.approx(from_dict['sd'])
        assert item['median'] == from_dict['median']


def test_multiple_items_and_reverse_scoring():
    result = analyze_frequencies(text='''Item 5: 1=30, 2=23, 3=20, 4=45, 5=35
Item 6 [reverse]: 1=10, 2=20, 3=30, 4=25, 5=15''')
    assert len(result['items']) == 2
    reversed_item = result['items'][1]
    assert reversed_item['reversed'] is True
    assert reversed_item['n'] == 100
    assert reversed_item['mean'] == pytest.approx((10*5+20*4+30*3+25*2+15*1)/100)
    assert reversed_item['table'][0]['frequency'] == 10
    assert reversed_item['table'][0]['score'] == 5
    assert 'original' in reversed_item['interpretation'].lower()


def test_global_reverse_scoring_changes_mean_but_not_sd_or_raw_top():
    raw = analyze_frequencies(items=FREQ)['items'][0]
    reverse = analyze_frequencies(items=FREQ, reversed=True)['items'][0]
    assert raw['mean'] + reverse['mean'] == pytest.approx(6)
    assert raw['sd'] == pytest.approx(reverse['sd'])
    assert raw['top_response'] == reverse['top_response']
    assert reverse['mode'] == '2'
    assert reverse['median'] == 2


def test_population_sd_and_single_observation_n1():
    item = analyze_frequencies(items={'a': {'1': 1}})['items'][0]
    assert item['sd'] is None
    assert item['median'] == 1
    population = analyze_frequencies(items={'a': {'1': 1}}, sd_method='population')['items'][0]
    assert population['sd'] == 0
    complete = analyze_frequencies(items=FREQ, sd_method='population')['items'][0]
    assert complete['sd'] == pytest.approx(math.sqrt(complete['formula']['squared_sum'] / 153))


def test_even_median_tied_modes_and_zero_category():
    item = analyze_frequencies(items={'x': {'1': 1, '5': 1}})['items'][0]
    assert item['median'] == 3
    assert item['mode_scores'] == [1.0, 5.0]
    assert item['top_response'] == 'Strongly Disagree / Strongly Agree'
    assert all(e['frequency'] == 0 for e in item['table'][1:4])


def test_custom_noncontiguous_codes():
    item = analyze_frequencies(scale_labels={'0':'Never','2':'Sometimes','10':'Always'},
                               items={'Question: X': {'Never': 5, 'Sometimes': 10, 'Always': 3}},
                               reverse_items=['Question: X'])['items'][0]
    assert item['n'] == 18
    assert item['table'][0]['score'] == 10
    assert item['table'][-1]['score'] == 0
    assert item['mean'] == pytest.approx((5*10+10*2+3*0)/18)


@pytest.mark.parametrize('payload,fragment', [
    ({'text':'Item 5: 1=10\nTotal N = 11'}, 'sum to 10'),
    ({'text':'Item 5: 1=-10'}, 'non-negative'),
    ({'text':'Item 5: 1=3\n1=4'}, 'repeated'),
    ({'text':'Item 5: 6=99'}, 'cannot read'),
    ({'items': {'x': {'1': -1}}}, 'non-negative'),
    ({'items': {'x': {'1': True}}}, 'non-negative'),
    ({'items': {'x': {'1': 0}}}, 'at least one'),
    ({'items': {'x': {'1': 3}}, 'reverse_items':['unknown']}, 'unknown'),
    ({'items': {'x': {'1': 3}}, 'sample_size':300, 'population_size':50}, 'larger'),
    ({'text': 'Item 5: 1=3', 'items': {'x': {'1': 3}}}, 'either'),
])
def test_fails_closed_on_invalid_input(payload, fragment):
    with pytest.raises(SummaryError) as error:
        analyze_frequencies(**payload)
    assert fragment.lower() in str(error.value).lower()


def test_csv_export_and_formula_injection_protection():
    result = analyze_frequencies(items={'=SUM(1,2)': {'1': 2, '2':3}})
    csv_text = summary_csv(result)
    frame = pd.read_csv(StringIO(csv_text))
    assert frame.loc[0, 'Item'].startswith("'=SUM")
    assert frame.loc[0, 'N'] == 5
    assert list(frame.columns) == ['Item','N','Mean','SD','Mode (scored code)','Top response (original)']
    assert len(summary_frame(result)) == 1


def test_rest_endpoint_needs_no_uploaded_dataset_and_returns_clear_limitations():
    client=TestClient(app)
    before = len(sessions)
    response=client.post('/api/frequency-only/analyze', json={
        'text': EXAMPLE, 'scale_labels': DEFAULT_LABELS, 'sample_size':200, 'population_size':2000})
    assert response.status_code == 200
    data=response.json()
    assert data['items'][0]['n']==153
    assert 'Cronbach' in data['limitations']
    assert 'regression' in data['limitations']
    assert len(sessions) == before
    csv_response=client.post('/api/frequency-only/summary.csv',json={'items':FREQ})
    assert csv_response.status_code == 200
    assert csv_response.headers['content-type'].startswith('text/csv')
    assert 'Item 5' in csv_response.text


def test_rest_rejects_incorrect_total_and_case_level_handoff():
    client=TestClient(app)
    assert client.post('/api/frequency-only/analyze', json={'text':'Item 5: 1=30\nTotal N=40'}).status_code==422
    assert client.post('/api/frequency-only/analyze', json={'items':FREQ,'rows':[1,2,3]}).status_code==422
