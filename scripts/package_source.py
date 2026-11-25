#!/usr/bin/env python3
"""Package corresponding application source, including the retained OpenGym checkout."""
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT=Path(__file__).resolve().parent.parent
EXCLUDE={'.git','.venv','.aws','.agents','.codex','node_modules','__pycache__','.pytest_cache','var','certs','dist','.DS_Store','DerivedData'}


def public_file(path):
    relative=path.relative_to(ROOT)
    return (path.is_file() and not path.is_symlink() and not any(p in EXCLUDE or p.endswith(('.egg-info','.xcodeproj')) for p in relative.parts)
            and path.name!='.mcp.json'
            and not path.name.endswith(('.pyc','.sqlite3','.sqlite3-wal','.sqlite3-shm'))
            and not (path.name.startswith('.env') and path.name!='.env.example'))


files=set()
# Also works from an extracted source archive without Git metadata.
for directory,folders,names in os.walk(ROOT,followlinks=False):
    folders[:]=[name for name in folders if name not in EXCLUDE and not name.endswith(('.egg-info','.xcodeproj'))]
    files.update(Path(directory)/name for name in names)
# Built assets make the archive runnable without installing Node; their source is above.
assets=ROOT/'aesthetic_lab/opengym_static'
if assets.exists():files.update(assets.rglob('*'))
archive=ROOT/'dist/aesthetic-lab-source.zip'
archive.parent.mkdir(parents=True,exist_ok=True)
with ZipFile(archive,'w',compression=ZIP_DEFLATED) as output:
    for path in sorted(files):
        if public_file(path):output.write(path,path.relative_to(ROOT))
with ZipFile(archive) as output:
    names=output.namelist()
    assert 'opengym/frontend/src/App.jsx' in names and 'opengym/LICENSE' in names
    assert 'aesthetic_lab/opengym_static/index.html' in names
print(f'Packaged {len(names)} files: {archive}')
