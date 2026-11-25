import hashlib
import json
from pathlib import Path
from aesthetic_lab.config import ROOT


def test_every_bundled_image_matches_manifest_and_is_self_hosted(client):
    r=client.get('/exercise-media/manifest.json');assert r.status_code==200
    manifest=r.json();assert len(manifest['files'])>=390
    assert manifest['source']=='https://github.com/RepDB/exercise-dataset'
    for f in manifest['files']:
        assert f['url'].startswith('/exercise-media/') and '..' not in f['url']
        from urllib.parse import unquote
        path=ROOT/'aesthetic_lab/exercise_media'/unquote(f['url'].removeprefix('/exercise-media/'))
        data=path.read_bytes()
        assert len(data)==f['bytes'] and hashlib.sha256(data).hexdigest()==f['sha256']


def test_media_route_serves_photos_diagrams_and_license_without_exposing_private_files(client):
    manifest=client.get('/exercise-media/manifest.json').json()
    for ext,mime in (('.jpg','image/jpeg'),('.svg','image/svg+xml'),('.webp','image/webp')):
        f=next(f for f in manifest['files'] if f['url'].endswith(ext))
        r=client.get(f['url']);assert r.status_code==200 and r.headers['content-type'].startswith(mime)
    assert 'public domain' in client.get('/exercise-media/LICENSE.free-exercise-db.txt').text
    assert 'RepDB' in client.get('/exercise-media/RepDB-LICENSE-DATA.md').text
    assert client.get('/exercise-media/%2e%2e/%2e%2e/.env').status_code in (400,404)
