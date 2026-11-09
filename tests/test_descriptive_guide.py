"""Numerical and usability regression tests for guided descriptive reports."""
import io

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.descriptive_guide import guided_descriptive, MAX_SHOWN_CATEGORIES
from app.main import app, sessions
from app.stats_engine import AnalysisError
from app.variables import init_variables


def report(df, cols, detail='simple', specs=None):
    return guided_descriptive(df, cols, specs or init_variables(df), detail)


def test_scale_sample_sd_and_mean_are_not_changed():
    df = pd.DataFrame({'marks':[3, 4, 5, 7, np.nan]})
    out = report(df, ['marks'])
    row = out['tables'][0]['rows'][0]
    assert row[:4] == ['marks', 4, 1, 4.75]
    assert row[4] == round(df.marks.std(ddof=1), 2)
    assert row[5:8] == [4.5, 3.0, 7.0]
    assert len(out['chart']['labels']) == len(out['chart']['values'])
    assert sum(out['chart']['values']) == 4
    assert len(out['insights']) == 1


def test_nominal_numeric_codes_have_no_mean_and_respect_labels():
    df = pd.DataFrame({'sex':[1, 2, 1, 1, np.nan]})
    specs = init_variables(df)
    specs['sex']['measure'] = 'nominal'
    specs['sex']['value_labels'] = [
        {'value':'1','label':'Woman'}, {'value':'2','label':'Man'}]
    out = report(df, ['sex'], specs=specs)
    assert not any('Average (mean)' in t['columns'] for t in out['tables'])
    rows = out['tables'][0]['rows']
    assert rows[0] == ['1 — Woman', 3, 75.0]
    assert rows[1] == ['2 — Man', 1, 25.0]
    assert rows[-1] == ['TOTAL VALID', 4, 100.0]
    assert out['summary_cards'][-1]['value'] == 1
    assert out['chart']['values'] == [3, 1]


def test_ordinal_numeric_median_not_continuous_mean():
    df = pd.DataFrame({'agreement':[1, 2, 2, 4]})
    specs = init_variables(df)
    specs['agreement']['measure'] = 'ordinal'
    out = report(df, ['agreement'], specs=specs)
    assert out['tables'][0]['rows'][0][3] == '2'
    assert 'Average (mean)' not in out['tables'][0]['columns']
    freq = out['tables'][1]['rows']
    assert [r[0] for r in freq[:-1]] == ['1', '2', '4']
    assert [r[1] for r in freq[:-1]] == [1, 2, 1]


def test_text_ordinal_does_not_invent_category_order():
    df = pd.DataFrame({'rating':['Good', 'Bad', 'Good', 'Excellent']})
    specs = init_variables(df)
    specs['rating']['measure'] = 'ordinal'
    out = report(df, ['rating'], specs=specs)
    assert out['tables'][0]['rows'][0][3] is None
    assert any('no defined order' in w for w in out['warnings'])


def test_missing_values_denominator_correct_and_unanswered_variable():
    df = pd.DataFrame({'group':['A','B',None,'A'], 'empty':[np.nan]*4})
    out = report(df, ['group', 'empty'])
    g = next(t for t in out['tables'] if t['title'].startswith('Answers: group'))
    assert g['rows'] == [['A', 2, round(200/3, 1)], ['B', 1, round(100/3, 1)], ['TOTAL VALID', 3, 100.0]]
    assert out['summary_cards'][2]['value'] == 3
    assert out['summary_cards'][3]['value'] == 5
    assert any('no valid' in w for w in out['warnings'])


def test_detailed_adds_only_numeric_advanced_table():
    df = pd.DataFrame({'score':[1,2,3,4,5], 'city':['N','A','N','A','N']})
    out = report(df, ['score','city'], 'detailed')
    advanced = next(t for t in out['tables'] if t['title'].startswith('Extra statistics'))
    row = advanced['rows'][0]
    assert row[0:3] == ['score', 5, 2.5]
    assert row[3:6] == [2.0, 4.0, 2.0]
    assert out['detail_level'] == 'detailed'
    simple = report(df, ['score','city'])
    assert not any(t['title'].startswith('Extra statistics') for t in simple['tables'])


def test_many_categories_show_other_without_losing_count():
    df = pd.DataFrame({'id':[f'ID{i}' for i in range(21)]})
    out = report(df,['id'])
    rows = out['tables'][0]['rows']
    assert len(rows) == MAX_SHOWN_CATEGORIES + 2
    assert rows[-2][1] == 21 - MAX_SHOWN_CATEGORIES
    assert sum(row[1] for row in rows[:-1]) == 21
    assert out['chart']['values'][-1] == 21-MAX_SHOWN_CATEGORIES
    assert any('listed individually' in w for w in out['warnings'])


def test_scale_with_only_five_integer_categories_prompts_measure_review():
    df = pd.DataFrame({'likert':[1,2,3,4,5]})
    out = report(df,['likert'])
    assert any('review its Measure' in w for w in out['warnings'])


def test_date_range_and_missing_counts():
    df = pd.DataFrame({'interviewed':pd.to_datetime(['2026-01-02', None, '2026-03-01'])})
    out = report(df,['interviewed'])
    assert out['tables'][0]['rows'][0] == ['interviewed',2,1,'2026-01-02','2026-03-01']
    assert out['insights'][0]['kind']=='Date'


def test_guard_unknown_empty_too_many_and_invalid_mode():
    df = pd.DataFrame({f'v{i}':[i,i+1] for i in range(35)})
    for cols,detail in [([], 'simple'), (['wrong'],'simple'), (list(df.columns),'simple'), (['v1'],'not_a_mode')]:
        with pytest.raises(AnalysisError):
            report(df,cols,detail)


def test_api_excludes_user_missing_and_keeps_raw_export():
    sessions.clear()
    client = TestClient(app)
    raw=b'score,gender\n1,1\n2,2\n99,1\n3,2\n'
    try:
        uploaded=client.post('/api/datasets',files={'file':('survey.csv',io.BytesIO(raw))})
        assert uploaded.status_code==200
        ds=uploaded.json()['dataset_id']
        patched=client.patch(f'/api/datasets/{ds}/variables/score',json={'missing_values':['99']})
        assert patched.status_code==200,patched.text
        assert client.patch(f'/api/datasets/{ds}/variables/gender',json={'measure':'nominal','value_labels':[{'value':'1','label':'Female'},{'value':'2','label':'Male'}]}).status_code==200
        a=client.post('/api/analyze',json={'dataset_id':ds,'analysis':'descriptives','columns':['score','gender'], 'detail_level':'simple'})
        assert a.status_code==200,a.text
        ans=a.json()
        assert ans['tables'][0]['rows'][0][1:5]==[3,1,2.0,1.0]
        assert ans['summary_cards'][-1]['value']==1
        assert any('user-defined missing' in w for w in ans['warnings'])
        assert ans['variable_definitions'][1]['measure']=='nominal'
        assert '1 — Female' in [r[0] for r in ans['tables'][1]['rows']]
        csv=client.get(f'/api/datasets/{ds}/download.csv').text
        assert '99' in csv
    finally:
        sessions.clear()


def test_api_rejects_bad_detail_level():
    sessions.clear()
    client=TestClient(app)
    try:
        dataset=client.post('/api/datasets',files={'file':('survey.csv',io.BytesIO(b'v\n1\n2\n3\n'))}).json()['dataset_id']
        r=client.post('/api/analyze',json={'dataset_id':dataset,'analysis':'descriptives','columns':['v'],'detail_level':'expert'})
        assert r.status_code==422
    finally:
        sessions.clear()
