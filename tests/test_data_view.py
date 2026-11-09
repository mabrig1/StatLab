"""Regression checks for editable, paginated SPSS-like Data View."""
import io
import pytest
from fastapi.testclient import TestClient
from app.main import app, sessions

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated():
    sessions.clear()
    yield
    sessions.clear()


def loaded(raw=b"id,score,group,respondent\n1,12,A,Alice\n2,35,B,Bob\n3,,A,Cathy\n4,99,B,Denise\n"):
    response=client.post('/api/datasets',files={'file':('cases.csv', io.BytesIO(raw))})
    assert response.status_code==200,response.text
    data=response.json()
    return f"/api/datasets/{data['dataset_id']}",data


def update(path, old, changes):
    result=client.patch(path+'/rows/cells',json={'revision':old['revision'], 'edits':changes})
    assert result.status_code==200,result.text
    return result.json()


def test_paging_search_and_original_order_survive_sort():
    path,d=loaded()
    r=client.get(path+'/rows',params={'offset':0,'limit':25}).json()
    assert r['total']==4 and r['filtered']==4
    assert [row['index'] for row in r['rows']]==[0,1,2,3]
    desc=client.get(path+'/rows?sort=score&descending=true').json()
    assert [row['index'] for row in desc['rows']]==[3,1,0,2]  # nulls always last
    assert client.get(path+'/rows?query=bob').json()['rows'][0]['index']==1
    assert client.get(path+'/rows?column=group&query=a&operator=equals').json()['filtered']==2
    assert client.get(path+'/rows?column=score&operator=is_missing').json()['rows'][0]['index']==2
    assert client.get(path+'/rows?column=score&operator=is_valid').json()['filtered']==3
    assert client.get(path+'/rows?column=unknown').status_code==422
    assert client.get(path+'/rows?limit=1000').status_code==422
    assert client.get(path+'/rows?column=respondent&operator=unexpected').status_code==422
    assert client.get(path+'/rows?operator=is_missing').status_code==422


def test_numeric_and_string_edits_update_analyses_and_export():
    path,d=loaded()
    d=update(path,d,[{'row':0,'column':'score','value':'23.5'}, {'row':1,'column':'respondent','value':'Bobby'}])
    page=client.get(path+'/rows').json()
    assert page['rows'][0]['values'][1]==23.5
    assert page['rows'][1]['values'][3]=='Bobby'
    assert d['can_undo'] and not d['can_redo']
    assert '23.5' in client.get(path+'/download.csv').text
    analysis=client.post('/api/analyze',json={'dataset_id':d['dataset_id'],'analysis':'descriptives','columns':['score']})
    assert analysis.status_code==200,analysis.text
    assert analysis.json()['provenance']['data_revision']==1


def test_atomic_edit_validation_and_optimistic_locking():
    path,d=loaded()
    invalid=client.patch(path+'/rows/cells',json={'revision':0,'edits':[
        {'row':0,'column':'score','value':'8'}, {'row':1,'column':'score','value':'nonsense'}]})
    assert invalid.status_code==422
    assert client.get(path+'/rows').json()['rows'][0]['values'][1]==12
    assert client.get(path).json()['revision']==0
    changed=update(path,d,[{'row':0,'column':'score','value':'8'}])
    stale=client.patch(path+'/rows/cells',json={'revision':0,'edits':[{'row':0,'column':'score','value':'100'}]})
    assert stale.status_code==422
    assert client.get(path+'/rows').json()['rows'][0]['values'][1]==8
    outofbounds=client.patch(path+'/rows/cells',json={'revision':changed['revision'],'edits':[{'row':10,'column':'score','value':'5'}]})
    assert outofbounds.status_code==422


def test_paste_autoinsert_and_history():
    path,d=loaded()
    r=client.post(path+'/rows/paste',json={'revision':0,'row':3,'column':'score',
                                           'values':[['20','B','Dee'],['25','A','Echo']]})
    assert r.status_code==200,r.text
    d=r.json();assert d['rows']==5 and d['revision']==1
    assert client.get(path+'/rows').json()['rows'][4]['values'][3]=='Echo'
    r=client.post(path+'/history/undo',json={'revision':1});assert r.status_code==200,r.text
    d=r.json();assert d['rows']==4 and d['can_redo']
    page=client.get(path+'/rows').json();assert page['rows'][3]['values'][1]==99
    r=client.post(path+'/history/redo',json={'revision':2});assert r.status_code==200,r.text
    assert r.json()['rows']==5
    assert client.get(path+'/rows').json()['rows'][4]['values'][1]==25


def test_add_and_delete_cases_then_restore_original_positions():
    path,d=loaded()
    r=client.post(path+'/rows',json={'revision':0,'count':2})
    assert r.status_code==200,r.text;d=r.json();assert d['rows']==6
    assert client.get(path+'/rows').json()['rows'][-1]['system_missing']==[True]*4
    r=client.post(path+'/rows/delete',json={'revision':1,'indexes':[1,3]})
    assert r.status_code==200,r.text;d=r.json();assert d['rows']==4
    assert [x['values'][0] for x in client.get(path+'/rows').json()['rows']]==[1,3,None,None]
    r=client.post(path+'/history/undo',json={'revision':2});assert r.status_code==200,r.text
    assert [x['values'][0] for x in client.get(path+'/rows').json()['rows']]==[1,2,3,4,None,None]
    r=client.post(path+'/history/undo',json={'revision':3});assert r.status_code==200,r.text
    assert r.json()['rows']==4


def test_missing_codes_and_labels_stay_raw_for_editor():
    path,d=loaded()
    r=client.patch(path+'/variables/score',json={'missing_values':['99'], 'value_labels':[{'value':'99','label':'Unanswered'}]})
    assert r.status_code==200,r.text
    page=client.get(path+'/rows').json()
    assert page['rows'][3]['values'][1]==99
    assert page['rows'][3]['labelled'][1]=='Unanswered'
    assert page['rows'][3]['user_missing'][1] is True
    assert client.get(path+'/rows?column=score&operator=is_missing').json()['filtered']==2
    assert client.get(path+'/rows?column=score&operator=is_valid').json()['filtered']==2
    assert client.get(path+'/rows?column=score&operator=contains&query=Unanswered').json()['filtered']==1


def test_width_guard_for_strings_and_no_partial_paste():
    path,d=loaded()
    rejected=client.post(path+'/rows/paste',json={'revision':0,'row':0,'column':'respondent',
        'values':[['x'*25],['OK']]})
    assert rejected.status_code==422
    assert client.get(path).json()['revision']==0
    assert client.get(path+'/rows').json()['rows'][0]['values'][3]=='Alice'
    good=client.patch(path+'/variables/respondent',json={'width':30});assert good.status_code==200
    accepted=client.patch(path+'/rows/cells',json={'revision':1,'edits':[{'row':0,'column':'respondent','value':'x'*25}]})
    assert accepted.status_code==200,accepted.text


def test_date_entries_validate_iso_and_can_be_undone():
    path,d=loaded()
    r=client.post(path+'/variables',json={'name':'interview_date','type':'date'})
    assert r.status_code==200,r.text;d=r.json()
    bad=client.patch(path+'/rows/cells',json={'revision':1,'edits':[{'row':0,'column':'interview_date','value':'09/11/2026'}]})
    assert bad.status_code==422
    good=client.patch(path+'/rows/cells',json={'revision':1,'edits':[{'row':0,'column':'interview_date','value':'2026-11-09'}]})
    assert good.status_code==200,good.text
    page=client.get(path+'/rows').json()
    assert str(page['rows'][0]['values'][-1]).startswith('2026-11-09')
    undo=client.post(path+'/history/undo',json={'revision':2})
    assert undo.status_code==200,undo.text
    assert client.get(path+'/rows').json()['rows'][0]['values'][-1] is None


def test_metadata_change_clears_history_to_prevent_misapplied_undos():
    path,d=loaded()
    d=update(path,d,[{'row':0,'column':'score','value':5}])
    assert d['can_undo']
    r=client.patch(path+'/variables/score',json={'name':'test_score'})
    assert r.status_code==200
    assert not r.json()['can_undo']
    assert client.post(path+'/history/undo',json={'revision':2}).status_code==422


def test_reject_paste_outside_columns_and_maximum_batch():
    path,d=loaded()
    too_wide=client.post(path+'/rows/paste',json={'revision':0,'row':0,'column':'respondent','values':[['A','B']]})
    assert too_wide.status_code==422
    too_many=client.post(path+'/rows/paste',json={'revision':0,'row':0,'column':'id','values':[['5']]*101})
    assert too_many.status_code==200  # 101 cells, only 97 new cases -> allowed
    stale=client.post(path+'/rows/paste',json={'revision':0,'row':0,'column':'id','values':[['5']]})
    assert stale.status_code==422


def test_blank_dataset_from_scratch_and_export():
    r=client.post('/api/datasets/blank',json={'filename':'My fieldwork','variable':'Q1','type':'numeric','rows':10})
    assert r.status_code==200,r.text
    d=r.json();assert d['filename']=='My fieldwork.csv'
    assert d['rows']==10 and d['columns']==1
    path=f"/api/datasets/{d['dataset_id']}"
    assert all(row['values']==[None] for row in client.get(path+'/rows').json()['rows'])
    d=update(path,d,[{'row':0,'column':'Q1','value':'5'}]);assert d['rows']==10
    assert '5' in client.get(path+'/download.csv').text
    assert client.post('/api/datasets/blank',json={'filename':'..','variable':'!bad','rows':3}).status_code==422
    assert client.post('/api/datasets/blank',json={'filename':'test','variable':'A','type':'numeric','rows':101}).status_code==422
