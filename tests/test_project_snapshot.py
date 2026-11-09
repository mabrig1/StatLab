"""Real Data View / Variable View backup and safe restore contract."""
import copy
import io
import pytest
from fastapi.testclient import TestClient
from app.main import app, sessions

@pytest.fixture
def client():
    sessions.clear()
    yield TestClient(app)
    sessions.clear()


def test_script_assets_load_and_version(client):
    assert client.get('/api/health').json()['version'] == '0.9.0'
    for path in ['chapter_four.js','projects.js','projects.css']:
        r=client.get('/static/'+path)
        assert r.status_code==200, path
        assert len(r.content)>100
    assert client.get('/static/not-a-file.js').status_code==404


def test_snapshot_round_trip_preserves_case_data_and_codebook(client):
    source=b'satisfaction,gender,date\n1,M,2026-01-01\n5,F,2026-01-03\n,M,\n'
    uploaded=client.post('/api/datasets',files={'file':('survey.csv',io.BytesIO(source))})
    assert uploaded.status_code == 200, uploaded.text
    ident=uploaded.json()['dataset_id']
    p=client.patch(f'/api/datasets/{ident}/variables/satisfaction',json={
        'measure':'ordinal','label':'Overall satisfaction?',
        'value_labels':[{'value':'1','label':'Very dissatisfied'}, {'value':'5','label':'Very satisfied'}],
        'missing_values':['99']})
    assert p.status_code==200, p.text
    p=client.patch(f'/api/datasets/{ident}/variables/date',json={'type':'date','width':24,'decimals':0})
    assert p.status_code==200, p.text
    snapshot_r=client.get(f'/api/datasets/{ident}/snapshot')
    assert snapshot_r.status_code==200,snapshot_r.text
    data=snapshot_r.json()
    assert data['schema']=='mabrig-statlab-dataset-snapshot-v1'
    assert data['observations']==[[1,'M','2026-01-01T00:00:00'],[5,'F','2026-01-03T00:00:00'],[None,'M',None]]
    assert data['variables'][0]['label']=='Overall satisfaction?'
    assert data['variables'][0]['value_labels'][1]['label']=='Very satisfied'
    restored=client.post('/api/datasets/from-snapshot',json=data)
    assert restored.status_code==200,restored.text
    info=restored.json()
    assert info['dataset_id']!=ident
    assert info['preview']==data['observations']
    assert info['variables'][0]['measure']=='ordinal'
    assert info['variables'][0]['missing_values']==['99']
    assert info['variables'][2]['type']=='date'
    # Restore digest is not misrepresented as the original CSV file hash.
    assert info['sha256']!=data['source_sha256']


def test_bad_snapshot_is_all_or_nothing(client):
    original=client.post('/api/datasets',files={'file':('test.csv',io.BytesIO(b'a,b\n1,2\n'))}).json()
    data=client.get(f"/api/datasets/{original['dataset_id']}/snapshot").json()
    before=len(sessions)
    for patch in [
        lambda x:x['observations'][0].append('unexpected'),
        lambda x:x['variables'][0].update({'name':'a;DROP'}),
        lambda x:x['variables'][1].update({'measure':'incorrect'}),
        lambda x:x.update({'schema':'not-an-original-format'}),
        lambda x:x['observations'][0].__setitem__(0,{'nested':'unsafe'}),
        lambda x:x['observations'][0].__setitem__(0,'not a number'),
        lambda x:x.update({'filename':'../../bad.csv'}),
    ]:
        invalid=copy.deepcopy(data)
        patch(invalid)
        response=client.post('/api/datasets/from-snapshot',json=invalid)
        assert response.status_code in {422,413}, response.text
        assert len(sessions)==before


def test_no_fabricated_rows_in_empty_data_snapshot(client):
    # The backup is still an actual dataset; zero rows remain zero rows.
    created=client.post('/api/datasets/blank',json={'filename':'Empty research','variable':'score','rows':1}).json()
    ident=created['dataset_id']
    erased=client.post(f'/api/datasets/{ident}/rows/delete',json={'revision':created['revision'],'indexes':[0]})
    # Data editor can reject deletion of the last row; do not assert synthetic rows were created.
    if erased.status_code==200:
        data=client.get(f'/api/datasets/{ident}/snapshot').json()
        assert data['observations']==[]
        restored=client.post('/api/datasets/from-snapshot',json=data)
        assert restored.status_code==200,restored.text
        assert restored.json()['rows']==0
