"""Questionnaire assistant: denominator, coding, validation and API integration regression tests."""
import io
import copy

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app, sessions
from app.questionnaire_guide import questionnaire_summary
from app.stats_engine import AnalysisError
from app.variables import init_variables


def summarize(df, groups, points=5, higher=True, min_pct=50, specs=None):
    return questionnaire_summary(df, groups, specs or init_variables(df), points, higher, min_pct)


def group(*items, reverse=(), title='Research objective'):
    return [{'title': title, 'items': list(items), 'reverse_items': list(reverse)}]


def test_frequencies_are_exact_and_objective_denominator_is_per_item_not_respondent():
    df = pd.DataFrame({'q1':[1, 2, 4, 5, np.nan], 'q2':[1, 2, np.nan, 5, 5]})
    before = df.copy(deep=True)
    outcome = summarize(df, group('q1','q2'))
    item = outcome['objectives'][0]
    assert item['valid_item_answers'] == 8
    assert item['missing_item_answers'] == 2
    assert item['favourable_item_answers'] == 4
    assert item['favourable_percent'] == 50
    assert item['cases_eligible'] == 5
    assert item['complete_cases'] == 3
    first = next(t for t in outcome['tables'] if t['title'].startswith('Question q1'))
    assert first['rows'][0][:2] == ['1',1]
    assert first['rows'][4] == ['5',1,25.0]
    assert first['rows'][-1] == ['TOTAL VALID',4,100.0]
    pd.testing.assert_frame_equal(df,before)
    assert outcome['scoring_settings']['raw_data_changed'] is False


def test_reverse_key_changes_scores_but_not_original_frequency_table():
    df=pd.DataFrame({'positive':[1,2,3,4,5], 'negative':[5,4,3,2,1]})
    without=summarize(df,group('positive','negative'))
    with_reversed=summarize(df,group('positive','negative',reverse=['negative']))
    assert without['objectives'][0]['composite_mean']==3
    assert without['objectives'][0]['composite_sd']==0
    assert with_reversed['objectives'][0]['composite_mean']==3
    assert with_reversed['objectives'][0]['composite_sd']==1.581
    assert with_reversed['objectives'][0]['cronbach_alpha']==1
    first_freq = [t for t in without['tables'] if t['title'].startswith('Question negative')][0]
    second_freq = [t for t in with_reversed['tables'] if t['title'].startswith('Question negative')][0]
    assert first_freq==second_freq


def test_reverse_key_with_positive_coded_direction_changes_counts():
    df=pd.DataFrame({'q':[1,1,2,3,4,5]})
    raw=summarize(df,group('q'),higher=True)
    rev=summarize(df,group('q',reverse=['q']),higher=True)
    lower=summarize(df,group('q'),higher=False)
    assert raw['objectives'][0]['favourable_item_answers']==2
    assert rev['objectives'][0]['favourable_item_answers']==3
    assert lower['objectives'][0]['favourable_item_answers']==3


def test_completion_threshold_is_ceiling_and_only_affects_respondent_means():
    df=pd.DataFrame({'a':[1,5,1,np.nan], 'b':[3,np.nan,1,np.nan], 'c':[5,np.nan,np.nan,np.nan]})
    half=summarize(df,group('a','b','c'),min_pct=50)['objectives'][0]
    full=summarize(df,group('a','b','c'),min_pct=100)['objectives'][0]
    assert half['min_items_answered']==2
    assert half['cases_eligible']==2
    assert full['min_items_answered']==3
    assert full['cases_eligible']==1
    assert half['valid_item_answers']==full['valid_item_answers']==6
    assert half['composite_mean'] != full['composite_mean']


def test_4_point_counts_and_labels_preserved():
    df=pd.DataFrame({'agree':[1,2,3,4,np.nan]})
    specs=init_variables(df)
    specs['agree']['measure']='ordinal'
    specs['agree']['value_labels']=[{'value':'1','label':'Strongly agree'},{'value':'4','label':'Strongly disagree'}]
    out=summarize(df,group('agree'),4,False,specs=specs)
    tab=next(t for t in out['tables'] if t['title'].startswith('Question agree'))
    assert tab['rows'][0]==['1 — Strongly agree',1,25.0]
    assert tab['rows'][3]==['4 — Strongly disagree',1,25.0]
    assert out['objectives'][0]['favourable_percent']==50


def test_no_complete_cases_alpha_omitted_with_explicit_warning():
    df=pd.DataFrame({'a':[1,2,np.nan], 'b':[np.nan,3,2], 'c':[np.nan,np.nan,4]})
    out=summarize(df,group('a','b','c'))
    assert out['objectives'][0]['cronbach_alpha'] is None
    assert any('alpha was unavailable' in w for w in out['warnings'])


def test_missing_all_suppresses_scores_and_cannot_invent_a_percent():
    df=pd.DataFrame({'q':[np.nan]*5})
    out=summarize(df,group('q'))
    assert out['objectives'][0]['favourable_percent'] is None
    assert out['objectives'][0]['composite_mean'] is None
    assert out['tables'][2]['rows'][-1]==['TOTAL VALID',0,None]


def test_overlap_across_objectives_is_flagged():
    df=pd.DataFrame({'x':[1,2,3,4], 'y':[4,3,2,1]})
    out=summarize(df,[{'title':'One','items':['x']}, {'title':'Two','items':['x','y']}])
    assert len(out['objectives'])==2
    assert any('multiple objectives' in w for w in out['warnings'])


@pytest.mark.parametrize('groups,params', [
    ([], {}),
    (group('missing'),{}),
    (group('q',reverse=['unknown']),{}),
    (group('q','q'),{}),
    (group('q'),{'points':7}),
    (group('q'),{'higher':None}),
    (group('q'),{'min_pct':25}),
    (group('q'),{'min_pct':True}),
    ([{'title':'','items':['q']}],{}),
])
def test_bad_questionnaire_configs_fail_closed(groups,params):
    df=pd.DataFrame({'q':[1,2,3]})
    with pytest.raises(AnalysisError):
        summarize(df,groups,**params)


def test_no_nominal_or_text_in_a_coded_score():
    df=pd.DataFrame({'text':['Agree','Disagree','Agree'], 'gender':[1,2,1]})
    specs=init_variables(df);specs['gender']['measure']='nominal'
    with pytest.raises(AnalysisError,match='numeric'):
        summarize(df,group('text'),specs=specs)
    with pytest.raises(AnalysisError,match='Nominal'):
        summarize(df,group('gender'),specs=specs)


def test_out_of_range_codes_are_not_disguised_as_valid():
    df=pd.DataFrame({'q':[1,2,99,np.nan]})
    with pytest.raises(AnalysisError, match='outside whole numbers 1–5'):
        summarize(df,group('q'))
    df2=pd.DataFrame({'q':[1,2,2.5]})
    with pytest.raises(AnalysisError,match='outside whole numbers'):
        summarize(df2,group('q'))


def test_scale_flag_generates_warning_not_false_certainty():
    df=pd.DataFrame({'q':[1,2,3,4,5]})
    out=summarize(df,group('q'))
    assert any('arithmetic composite' in w for w in out['warnings'])
    assert 'not significance tests' in out['narrative']


def test_reliability_invariant_to_opposite_recoding_of_one_item():
    df=pd.DataFrame({'q1':[1,2,3,4,5], 'q2':[5,4,3,2,1]})
    out=summarize(df,group('q1','q2',reverse=['q2']))
    assert out['objectives'][0]['cronbach_alpha']==1
    assert 'complete cases' in out['method']


def test_api_masks_missing_codes_and_returns_traceable_output():
    sessions.clear();client=TestClient(app)
    data=b'q1,q2,sex\n1,5,1\n2,4,1\n3,3,2\n4,2,2\n5,99,1\n'
    received=client.post('/api/datasets',files={'file':('questionnaire.csv',io.BytesIO(data))})
    assert received.status_code==200,received.text
    ident=received.json()['dataset_id']
    r=client.patch(f'/api/datasets/{ident}/variables/q2',json={'missing_values':[99],'measure':'ordinal'})
    assert r.status_code==200,r.text
    r=client.patch(f'/api/datasets/{ident}/variables/q1',json={'measure':'ordinal'})
    assert r.status_code==200,r.text
    original=copy.deepcopy(received.json()['preview'])
    payload={'dataset_id':ident,'analysis':'questionnaire','scale_points':5,
             'higher_is_favourable':True,'min_answered_pct':50,
             'objectives':group('q1','q2',reverse=['q2'],title='Perceptions')}
    response=client.post('/api/analyze',json=payload)
    assert response.status_code==200,response.text
    body=response.json();obj=body['objectives'][0]
    assert obj['valid_item_answers']==9
    assert obj['missing_item_answers']==1
    assert obj['cases_eligible']==5
    assert obj['complete_cases']==4
    assert body['variable_definitions'][1]['user_missing_codes']==['99']
    assert body['provenance']['user_missing_excluded'] is True
    assert len(body['provenance']['sha256'])==64
    assert client.get(f'/api/datasets/{ident}').json()['preview']==original
    assert client.get('/api/health').json()['version']=='0.9.0'
    sessions.clear()


def test_api_rejects_non_likert_nominal_or_out_of_range():
    sessions.clear();client=TestClient(app)
    received=client.post('/api/datasets',files={'file':('questionnaire.csv',io.BytesIO(b'q\n1\n2\n99\n'))})
    ident=received.json()['dataset_id']
    response=client.post('/api/analyze',json={'dataset_id':ident,'analysis':'questionnaire',
                                              'objectives':group('q'),'higher_is_favourable':True})
    assert response.status_code==422
    assert 'outside whole numbers' in response.text
    sessions.clear()
