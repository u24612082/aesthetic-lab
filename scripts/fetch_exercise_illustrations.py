#!/usr/bin/env python3
"""Bundle selected flat artwork for this application, preserving in-app attribution."""
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from urllib.parse import unquote
import httpx
from build_exercise_diagrams import build as build_diagrams

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'aesthetic_lab/exercise_media'
REVISION='66c4298af8d99b9dc397dad6699e508fb871d249'
RAW=f'https://raw.githubusercontent.com/RepDB/exercise-dataset/{REVISION}'
SOURCE='https://repdb.co'
normal=lambda name:re.sub(r'[^a-z0-9]','',name.lower()).removesuffix('s')


def main():
    rules=json.loads((ROOT/'aesthetic_lab/data/exercise_illustration_aliases.json').read_text(encoding='utf-8'))
    base_path=ROOT/'aesthetic_lab/static/exercise-media-data.js'
    base=json.loads(base_path.read_text(encoding='utf-8').split('export const EXERCISE_MEDIA=',1)[1])
    folder=OUT/'illustrations';folder.mkdir(exist_ok=True)
    with httpx.Client(timeout=35,follow_redirects=True,headers={'User-Agent':'AestheticLab in-app exercise illustrations'},limits=httpx.Limits(max_connections=6)) as client:
        r=client.get(RAW+'/exercises.json');r.raise_for_status();rows=r.json()['exercises'];index={row['id']:row for row in rows}
        names={normal(row['name_en']):row['id'] for row in rows}
        # Exact-name additions only; apparatus differences use the reviewed mappings.
        for key,asset in base['catalog'].items():
            if key not in rules['byAsset'] and normal(asset['name']) in names:rules['byAsset'][key]=names[normal(asset['name'])]
        wanted=set(rules['byAsset'].values())|{v['slug'] for v in rules['byName'].values()}
        missing=wanted-index.keys()
        if missing:raise ValueError('Unmatched illustration IDs: '+', '.join(sorted(missing)))
        for name in ('LICENSE-DATA.md','ATTRIBUTION.md'):
            r=client.get(RAW+'/'+name);r.raise_for_status();(OUT/('RepDB-'+name)).write_bytes(r.content)
        downloads=[];catalog={}
        for slug in sorted(wanted):
            frames=[];labels=[]
            paths=index[slug]['images']['flat']
            for pose in ('start','peak','main'):
                if pose not in paths:continue
                relative=paths[pose]
                if not relative.startswith('images/flat/'+slug+'-') or not relative.endswith('.webp'):raise ValueError('Unexpected image path')
                path=folder/Path(relative).name;frames.append('/exercise-media/illustrations/'+path.name);downloads.append((RAW+'/'+relative,path));labels.append({'start':'Start','peak':'Peak','main':'Pose'}[pose])
            catalog[slug]={'name':index[slug]['name_en'],'kind':'illustration','frames':frames,'labels':labels,
                           'source':'Exercise data by RepDB (repdb.co)','source_url':SOURCE,'license_url':'/exercise-media/RepDB-LICENSE-DATA.md'}
        def download(item):
            url,path=item
            if path.exists() and path.read_bytes()[:4]==b'RIFF':return
            r=client.get(url);r.raise_for_status()
            if r.content[:4]!=b'RIFF' or r.content[8:12]!=b'WEBP':raise ValueError('Invalid WebP: '+path.name)
            path.write_bytes(r.content)
        with ThreadPoolExecutor(max_workers=6) as pool:
            for i,f in enumerate(as_completed([pool.submit(download,d) for d in downloads]),1):
                f.result()
                if i%30==0 or i==len(downloads):print(f'Illustration files: {i}/{len(downloads)}',flush=True)
    data={'revision':REVISION,'catalog':catalog,'byAsset':rules['byAsset'],'byName':{normal(k):v for k,v in rules['byName'].items()}}
    (ROOT/'aesthetic_lab/static/exercise-illustration-data.js').write_text('// Selected in-app assets. See exercise_media/RepDB-LICENSE-DATA.md.\nexport const EXERCISE_ILLUSTRATIONS='+json.dumps(data,separators=(',',':'))+'\n')
    build_diagrams()
    used={frame for a in base['catalog'].values() for frame in a['frames']}|{frame for a in catalog.values() for frame in a['frames']}
    used.update('/exercise-media/areas/'+p.name for p in (OUT/'areas').glob('*.svg'))
    files=[]
    for url in sorted(used):
        p=OUT/unquote(url.removeprefix('/exercise-media/'));files.append({'url':url,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size})
    version=hashlib.sha256(''.join(f['sha256'] for f in files).encode()).hexdigest()[:16]
    manifest={'version':'illustrated-exercises-'+version,'source':'https://github.com/RepDB/exercise-dataset','revision':REVISION,'files':files}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(f'Added {len(catalog)} illustrated movement references ({len(downloads)} files).',flush=True)


if __name__=='__main__':main()
