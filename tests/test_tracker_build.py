import json
import os
from scripts.build_tracker import publish_assets


def test_update_publishes_code_before_html_and_retains_previous_build(tmp_path,monkeypatch):
    target=tmp_path/'live';dist=tmp_path/'build'
    for directory in (target,dist):
        (directory/'assets').mkdir(parents=True)
    (target/'index.html').write_text('old HTML')
    (target/'assets/old.js').write_text('previous code')
    (target/'assets/obsolete.js').write_text('older than previous')
    (target/'offline-assets.json').write_text(json.dumps({'files':['./assets/old.js']}))
    (dist/'index.html').write_text('new HTML')
    (dist/'assets/new.js').write_text('new code')
    (dist/'startup.js').write_text('startup recovery')
    (dist/'offline-assets.json').write_text(json.dumps({'files':['./assets/new.js']}))
    (dist/'sw.js').write_text('new worker')
    replace=os.replace

    def checked_replace(source,destination):
        if destination==target/'index.html':
            assert (target/'assets/new.js').read_text()=='new code'
            assert (target/'assets/old.js').read_text()=='previous code'
            assert (target/'startup.js').read_text()=='startup recovery'
            assert (target/'index.html').read_text()=='old HTML'
        return replace(source,destination)

    monkeypatch.setattr(os,'replace',checked_replace)
    publish_assets(dist,target)
    assert (target/'index.html').read_text()=='new HTML'
    assert (target/'assets/old.js').is_file()
    assert not (target/'assets/obsolete.js').exists()
    assert not list(target.rglob('*.tmp'))
