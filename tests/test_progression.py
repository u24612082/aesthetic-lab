from datetime import date
import pytest

from aesthetic_lab.analytics import dashboard
from aesthetic_lab.ingest import ingest
from aesthetic_lab.models import IngestBatch


def gate(batch, exercise, amp, force, side='bilateral', balance=4):
    w=batch['workouts'][0]
    s=w['sets'][0];w['sets']=[s]
    s.update(exercise=exercise,equipment_id='machine-A',resistance_mode='standard',side=side,
             technique={'amplitudeStableScore':amp,'forceControlScore':force,'bilateralBalanceScore':balance,'evidence_source':'test-sensor'})
    ingest(IngestBatch.model_validate(batch))
    return dashboard(7,date(2026,10,31))['progression_gates'][0]


@pytest.mark.parametrize('exercise,amp,force,expected',[
    ('Incline Dumbbell Press',3,5,'hold'),('Incline Dumbbell Press',4,4,'passed'),
    ('Cable Lateral Raise',3,3,'passed'),('Cable Lateral Raise',5,2,'hold'),
    ('Unknown machine',5,5,'insufficient_data'),('Bench Press',None,5,'insufficient_data')])
def test_thresholds_and_missing_scores(batch,exercise,amp,force,expected):
    g=gate(batch,exercise,amp,force)
    assert g['status']==expected
    assert g['eligible_for_load_review']==(expected=='passed')


def test_unilateral_zero_balance_is_not_a_failure(batch):
    assert gate(batch,'Cable Lateral Raise',3,3,'left',0)['status']=='passed'


def test_low_bilateral_balance_holds_load(batch):
    assert gate(batch,'Bench Press',5,5,'bilateral',2)['status']=='hold'


def test_every_working_set_must_pass_and_new_unscored_session_revokes_pass(batch):
    assert gate(batch,'Bench Press',4,4)['status']=='passed'
    w=batch['workouts'][0];w['revision']=2
    import copy
    bad=copy.deepcopy(w['sets'][0]);bad['technique']['forceControlScore']=2;w['sets'].append(bad)
    ingest(IngestBatch.model_validate(batch))
    assert dashboard(7,date(2026,10,31))['progression_gates'][0]['status']=='hold'
    w['external_id']='next-session';w['started_at']='2026-10-31T20:00:00+02:00';w['ended_at']='2026-10-31T21:00:00+02:00'
    w['sets']=[w['sets'][0]];w['sets'][0]['technique']=None
    ingest(IngestBatch.model_validate(batch))
    assert dashboard(7,date(2026,10,31))['progression_gates'][0]['status']=='insufficient_data'
