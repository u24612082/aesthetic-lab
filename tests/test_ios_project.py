import importlib.util
from pathlib import Path
from xml.etree import ElementTree

spec = importlib.util.spec_from_file_location("prepare_ios", Path(__file__).parents[1] / "scripts/prepare_ios.py")
ios = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ios)


def test_generated_project_includes_all_bridge_sources_and_healthkit(tmp_path):
    source=tmp_path/'AestheticBridge';source.mkdir()
    for filename in ('AestheticBridgeApp.swift','BridgeHealth.swift','BridgeSettings.swift'):
        (source/filename).write_text('// test source')
    data,target=ios.project_spec(tmp_path)
    objects=data['objects']
    project=objects[data['rootObject']]
    assert target in project['targets']
    source_refs={k for k,v in objects.items() if v['isa']=='PBXFileReference' and v.get('path','').endswith('.swift')}
    phases=[objects[k] for k in objects[target]['buildPhases']]
    phase=next(p for p in phases if p['isa']=='PBXSourcesBuildPhase')
    assert {objects[k]['fileRef'] for k in phase['files']}==source_refs
    assert len(source_refs)==3
    assert project['attributes']['TargetAttributes'][target]['SystemCapabilities']['com.apple.HealthKit']['enabled']==1
    output=ios.prepare(tmp_path)
    scheme=ElementTree.parse(output/'xcshareddata/xcschemes/AestheticBridge.xcscheme')
    assert all(r.attrib['BlueprintIdentifier']==target for r in scheme.findall('.//BuildableReference'))
