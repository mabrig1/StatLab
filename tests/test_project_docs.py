"""Portable example for the new project manager: no individual cases needed."""
import json
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app, sessions


def test_example_project_is_frequency_only_and_recomputable():
    project=json.loads((Path(__file__).parents[1]/'samples'/'item5-example.statlab.json').read_text())
    assert project['schema']=='mabrig-statlab-project-v1'
    assert project['dataset'] is None
    assert project['frequency']['sd_method']=='sample'
    assert project['chapter_four']['assignments']=={'Item 5':'1'}
    client=TestClient(app)
    result=client.post('/api/frequency-only/analyze',json={
        'text':project['frequency']['text'],
        'scale_labels':{line.split(' = ')[0]:line.split(' = ')[1] for line in project['frequency']['labels'].splitlines()},
        'sd_method':project['frequency']['sd_method'],
    })
    assert result.status_code==200,result.text
    item=result.json()['items'][0]
    assert item['n']==153
    assert round(item['mean'],3)==3.209
    assert round(item['sd'],3)==1.454
    assert not sessions  # no case-level data generated to compute marginal statistics
