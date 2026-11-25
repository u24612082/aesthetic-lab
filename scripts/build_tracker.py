#!/usr/bin/env python3
"""Build and publish the retained OpenGym frontend without interrupting open pages."""
import os
import subprocess
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent


def publish_assets(dist: Path,target: Path):
    """Publish files before HTML; retain one previous build's hashed assets."""
    try:
        previous=json.loads((target/'offline-assets.json').read_text(encoding='utf-8')).get('files',[])
    except (OSError,ValueError):
        previous=[]
    current=json.loads((dist/'offline-assets.json').read_text(encoding='utf-8'))['files']
    target.mkdir(parents=True,exist_ok=True)

    def replace(source):
        destination=target/source.relative_to(dist)
        destination.parent.mkdir(parents=True,exist_ok=True)
        temporary=destination.with_name('.'+destination.name+'.tmp')
        try:
            temporary.write_bytes(source.read_bytes())
            os.replace(temporary,destination)
        finally:
            temporary.unlink(missing_ok=True)

    # Never remove the live directory or truncate a file being served. A phone
    # that received old HTML during this build still needs its previous chunks.
    last={'index.html','offline-assets.json','sw.js'}
    for source in sorted(dist.rglob('*')):
        if source.is_file() and source.relative_to(dist).as_posix() not in last:
            replace(source)
    for name in ('index.html','offline-assets.json','sw.js'):
        replace(dist/name)
    keep=set(previous)|set(current)
    for source in (target/'assets').rglob('*'):
        if source.is_file() and './'+source.relative_to(target).as_posix() not in keep:
            source.unlink()


def main():
    frontend=ROOT/'opengym/frontend'
    subprocess.run(['npm','run','build'],cwd=frontend,check=True)
    dist=frontend/'dist'
    # Stats and translations must work on their first visit offline. Changes
    # to the worker or startup loader also produce a new offline version.
    files=sorted('./'+path.relative_to(dist).as_posix() for path in (dist/'assets').rglob('*') if path.is_file())
    version=hashlib.sha256((dist/'index.html').read_bytes()+(dist/'sw.js').read_bytes()+(dist/'startup.js').read_bytes()+json.dumps(files).encode()).hexdigest()[:16]
    index=dist/'index.html'
    index.write_text(index.read_text(encoding='utf-8').replace('__BUILD_ID__',version))
    (dist/'offline-assets.json').write_text(json.dumps({'version':version,'files':files})+'\n',encoding='utf-8')
    worker=dist/'sw.js'
    worker.write_text(worker.read_text(encoding='utf-8').replace('__BUILD_ID__',version))
    target=ROOT/'aesthetic_lab/opengym_static'
    publish_assets(dist,target)
    print(f'Tracker assets ready: {target}')


if __name__=='__main__':
    main()
