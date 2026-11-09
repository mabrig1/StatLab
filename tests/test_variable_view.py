"""Regression tests for editable SPSS-style Variable View (v0.2)."""
import io
import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app, sessions
from app.variables import as_code, preview_label, VariableError

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_sessions():
    sessions.clear()
    yield
    sessions.clear()


def fixture_dataset():
    raw = b'gender,likert,response,age\n1,5,20,22\n2,4,10,19\n1,99,30,25\n2,3,99,21\n1,1,20,23\n'
    res = client.post('/api/datasets', files={'file': ('field.csv', io.BytesIO(raw))})
    assert res.status_code == 200, res.text
    return res.json()


def patch(id, name, data):
    return client.patch(f'/api/datasets/{id}/variables/{name}', json=data)


def test_variable_view_contains_all_editable_properties():
    d = fixture_dataset()
    v = d['variables'][0]
    assert v == {
        'name': 'gender', 'type': 'numeric', 'width': 8, 'decimals': 0,
        'label': '', 'value_labels': [], 'missing_values': [],
        'missing_range': None, 'columns': 12, 'align': 'right',
        'measure': 'scale', 'role': 'input',
        'missing': 0, 'system_missing': 0, 'user_missing': 0,
        'valid': 5, 'distinct': 2,
    }
    assert d['revision'] == 0
    assert d['labelled_preview'][0] == ['1', '5', '20', '22']


def test_variable_label_measure_role_labels_and_preview():
    d = fixture_dataset(); id = d['dataset_id']
    change = patch(id, 'gender', {
        'label': 'Respondent gender', 'measure': 'nominal', 'role': 'input',
        'value_labels': [
            {'value': '1', 'label': 'Male'}, {'value': '2.0', 'label': 'Female'}
        ], 'columns': 19, 'align': 'center', 'width': 12, 'decimals': 0,
    })
    assert change.status_code == 200, change.text
    out = change.json()
    g = out['variables'][0]
    assert g['label'] == 'Respondent gender'
    assert g['measure'] == 'nominal'
    assert g['value_labels'][1]['value'] == '2'
    assert out['labelled_preview'][0][0] == 'Male'
    assert out['labelled_preview'][1][0] == 'Female'
    assert out['preview'][1][0] == 2
    assert out['revision'] == 1
    data = client.get(f'/api/datasets/{id}/dictionary.json').json()
    assert data['schema'] == 'mabrig-statlab-variable-dictionary-v1'
    assert data['variables'][0]['label'] == 'Respondent gender'


def test_missing_values_excluded_in_frequencies_descriptives_and_preserved_in_csv():
    d = fixture_dataset(); id = d['dataset_id']
    before = client.post('/api/analyze', json={'dataset_id':id, 'analysis':'descriptives', 'columns':['likert']}).json()
    assert before['tables'][0]['rows'][0][1] == 5
    res = patch(id, 'likert', {
        'measure': 'ordinal', 'label':'I agree', 'missing_values':['99'],
        'value_labels':[{'value':str(i), 'label':str(i)} for i in range(1,6)]
    })
    assert res.status_code == 200, res.text
    var = res.json()['variables'][1]
    assert (var['system_missing'], var['user_missing'], var['missing'], var['valid']) == (0,1,1,4)
    descriptive = client.post('/api/analyze', json={'dataset_id':id, 'analysis':'descriptives', 'columns':['likert']}).json()
    assert descriptive['tables'][0]['rows'][0][1:3] == [4,1]
    assert descriptive['provenance']['variable_revision'] == 1
    assert descriptive['provenance']['user_missing_excluded'] is True
    frequency = client.post('/api/analyze', json={'dataset_id':id, 'analysis':'frequencies','a':'likert'}).json()
    table = frequency['tables'][0]
    assert 'Valid cases: 4; missing cases: 1' in table['note']
    assert all(str(row[0]) != '99' for row in table['rows'])
    original_export = client.get(f'/api/datasets/{id}/download.csv').text
    assert '1,99,30,25' in original_export


def test_missing_range_excludes_inclusive_bounds_and_discrete_code():
    d = fixture_dataset();id=d['dataset_id']
    res=patch(id,'response',{'missing_range':{'low':'10','high':'20'},'missing_values':['99']})
    assert res.status_code == 200, res.text
    var=res.json()['variables'][2]
    assert var['user_missing'] == 4
    outcome=client.post('/api/analyze',json={'dataset_id':id,'analysis':'descriptives','columns':['response']})
    assert outcome.status_code==200,outcome.text
    assert outcome.json()['tables'][0]['rows'][0][1:3] == [1,4]


def test_reject_duplicate_case_insensitive_names_atomically():
    d=fixture_dataset();id=d['dataset_id']
    failed=patch(id,'gender',{'name':'AGE','label':'should not be saved'})
    assert failed.status_code==422
    out=client.get(f'/api/datasets/{id}').json()
    assert out['revision']==0
    assert out['variables'][0]['name']=='gender'
    assert out['variables'][0]['label']==''


def test_rename_preserves_column_order_and_analysis_valid_names():
    d=fixture_dataset();id=d['dataset_id']
    change=patch(id,'gender',{'name':'respondent_gender'})
    assert change.status_code==200,change.text
    names=[v['name'] for v in change.json()['variables']]
    assert names==['respondent_gender','likert','response','age']
    assert client.post('/api/analyze',json={'dataset_id':id,'analysis':'frequencies','a':'gender'}).status_code==422
    assert client.post('/api/analyze',json={'dataset_id':id,'analysis':'frequencies','a':'respondent_gender'}).status_code==200
    assert client.get(f'/api/datasets/{id}/download.csv').text.startswith('respondent_gender,likert,response,age')


@pytest.mark.parametrize('patch_data',[
    {'name':'starts with space'},
    {'name':'9startsnumber'},
    {'type':'currency'},
    {'decimals':-1},
    {'width':0},
    {'columns':999},
    {'measure':'ratio'},
    {'align':'justify'},
    {'role':'evil'},
    {'label':'L'*256},
    {'extra_unexpected_field':1},
    {'value_labels':[{'value':'x','label':'Something'}]},
    {'value_labels':[{'value':1,'label':'Male'},{'value':'1.0','label':'Duplicate'}]},
    {'value_labels':[{'value':'1','label':''}]},
    {'missing_values':['99','99']},
    {'missing_values':['1','2','3','4']},
    {'missing_range':{'low':'20','high':'10'}},
    {'missing_range':{'low':'10','high':'20'},'missing_values':['1','2']},
    {'name':None},
    {'missing_range':{'lower':'1','upper':'2'}},
])
def test_bad_edits_fail_without_any_mutations(patch_data):
    d=fixture_dataset();id=d['dataset_id']
    response=patch(id,'gender',patch_data)
    assert response.status_code in [422,400],response.text
    assert client.get(f'/api/datasets/{id}').json()['revision']==0


def test_type_conversion_rejects_lossy_changes_without_modifying_data():
    res=client.post('/api/datasets',files={'file':('mixed.csv',io.BytesIO(b'mixed,code\nalpha,1\n5,2\n'))})
    id=res.json()['dataset_id']
    failed=patch(id,'mixed',{'type':'numeric'})
    assert failed.status_code==422
    assert res.json()['variables'][0]['type']=='string'
    assert client.get(f'/api/datasets/{id}').json()['revision']==0
    ok=patch(id,'code',{'type':'string','decimals':0})
    assert ok.status_code==200,ok.text
    assert ok.json()['variables'][1]['type']=='string'


def test_add_reorder_and_delete_variables():
    d=fixture_dataset();id=d['dataset_id']
    add=client.post(f'/api/datasets/{id}/variables',json={
        'name':'field_score','type':'numeric','measure':'ordinal',
        'label':'New field','value_labels':[{'value':'1','label':'Agree'}],
    })
    assert add.status_code==200,add.text
    assert add.json()['columns']==5
    assert add.json()['variables'][-1]['valid']==0
    assert add.json()['variables'][-1]['missing']==5
    assert add.json()['variables'][-1]['label']=='New field'
    assert client.post(f'/api/datasets/{id}/variables',json={'name':'FIELD_SCORE'}).status_code==422
    names=[v['name'] for v in add.json()['variables']]
    names=[names[-1],*names[:-1]]
    reorder=client.put(f'/api/datasets/{id}/variables/order',json={'order':names})
    assert reorder.status_code==200,reorder.text
    assert reorder.json()['variables'][0]['name']=='field_score'
    assert client.put(f'/api/datasets/{id}/variables/order',json={'order':names[:-1]}).status_code==422
    deleted=client.delete(f'/api/datasets/{id}/variables/field_score')
    assert deleted.status_code==200,deleted.text
    assert deleted.json()['columns']==4
    assert 'field_score' not in client.get(f'/api/datasets/{id}/download.csv').text
    assert deleted.json()['revision']==3


def test_cannot_delete_last_variable():
    res=client.post('/api/datasets',files={'file':('single.csv',io.BytesIO(b'only\n3\n5\n'))})
    id=res.json()['dataset_id']
    assert client.delete(f'/api/datasets/{id}/variables/only').status_code==422


def test_html_contains_variable_editing_workflow():
    page=client.get('/').text
    assert 'Variable View' in page
    for element in ['variable-search','add-variable','v-name','v-type','v-width','v-decimals','v-measure','v-role',
                    'value-label-rows','v-missing','v-range-low','v-range-high','save-variable','export-dictionary']:
        assert f'id="{element}"' in page


def test_date_string_labels_and_missing_values():
    res=client.post('/api/datasets',files={'file':('data.csv',io.BytesIO(b'event,answer\n2026-01-01,Y\n2026-01-02,N\n2026-01-03,NA\n'))})
    id=res.json()['dataset_id']
    converted=patch(id,'event',{'type':'date','decimals':0})
    assert converted.status_code==200,converted.text
    answer=patch(id,'answer',{'measure':'nominal','missing_values':['NA'],'value_labels':[{'value':'Y','label':'Yes'},{'value':'N','label':'No'}]})
    assert answer.status_code==200,answer.text
    assert answer.json()['labelled_preview'][0][1]=='Yes'
    assert answer.json()['variables'][1]['valid']==2
    assert client.post('/api/analyze',json={'dataset_id':id,'analysis':'frequencies','a':'answer'}).status_code==200
    assert patch(id,'answer',{'missing_range':{'low':'1','high':'2'}}).status_code==422
