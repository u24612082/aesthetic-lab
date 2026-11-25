#!/usr/bin/env python3
"""Original vector movement references for exercises absent from the photo library."""
from html import escape
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'aesthetic_lab/exercise_media'


def line(points,color='#edb892',width=12):
    if color=='#159961':color='#edb892'
    return f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>'


def circle(x,y,r=10):return f'<circle cx="{x}" cy="{y}" r="{r}" fill="#edb892"/><path d="M{x-r} {y}a{r} {r} 0 0 1 {2*r} 0" fill="#553b31"/>'


def svg(title,body):
    # Clothes on the original vector figures; equipment stays grey. Transparent
    # backgrounds let these small references sit directly in the exercise header.
    outfits={
        'Machine lateral raise':('180,76 180,117','170,130 190,130'),
        'Serratus cable punch · shoulder reach':('140,77 140,119','134,131 146,131'),
        'Tibialis raise · heels down, toes up':('115,80 129,119','130,132 141,128'),
        'Lean-away cable lateral raise':('160,82 173,120','173,134 185,130'),
        'Garhammer raise · knees start raised':('149,91 152,120','148,132 160,132'),
    }
    if title in outfits:
        shirt,shorts=outfits[title]
        body+=line(shirt,'#2696db',22)+line(shorts,'#192b40',18)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 250" role="img"><title>{escape(title)}</title><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="#159961" stroke-width="1.5"/></marker></defs>{body}</svg>'''


def movement(key,title,frames):
    paths=[]
    for i,body in enumerate(frames):
        path=OUT/'diagrams'/f'{key}-{i}.svg';path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(svg(title,body),encoding='utf-8');paths.append('/exercise-media/diagrams/'+path.name)
    return {'name':title,'kind':'diagram','frames':paths,'source':'Original Aesthetic Lab illustration','source_url':'','labels':['Start','Finish']}


def build():
    result={}
    grey='#b4bfcd';green='#159961'
    floor=line('45,210 315,210',grey,3)
    bench=line('60,155 285,155 285,160 60,160 60,155',grey,8)+line('80,165 80,208',grey,4)+line('260,165 260,208',grey,4)
    frames=[]
    for raised in (False,True):
        arms='150,80 116,80 83,78' if raised else '150,80 143,109 142,130'
        other='210,80 244,80 277,78' if raised else '210,80 217,109 218,130'
        frames.append(floor+line('151,95 151,148 209,148 209,95',grey,6)+line('148,148 148,204 211,204 211,148',grey,4)+circle(180,48)+line('180,66 180,130')+line('154,79 206,79')+line('180,130 154,152 148,204')+line('180,130 206,152 212,204')+line(arms,green)+line(other,green))
    result['diagram:machine-lateral-raise']=movement('machine-lateral-raise','Machine lateral raise',frames)
    frames=[]
    for reach in (False,True):
        shoulder=153 if reach else 141;hand=269 if reach else 247
        frames.append(floor+line('48,62 48,173',grey,6)+line(f'48,105 {hand},92',grey,2)+circle(140,48)+line('140,67 140,132')+line('140,132 121,173 114,207')+line('140,132 164,171 176,207')+line(f'{shoulder},80 194,91 {hand},92',green)+f'<path d="M240 64H278" fill="none" stroke="{green}" stroke-width="3" marker-end="url(#arrow)"/>')
    result['diagram:serratus-cable-punch']=movement('serratus-cable-punch','Serratus cable punch · shoulder reach',frames)
    frames=[]
    for lower in (False,True):
        body='115,132 176,119 221,109 266,99' if lower else '115,132 133,92 146,55 155,30'
        frames.append(floor+bench+circle(97,140,9)+line('115,132 92,112 72,146')+line(body,green)+f'<path d="M216 53Q252 69 271 116" fill="none" stroke="{green}" stroke-width="3" marker-end="url(#arrow)"/>')
    result['diagram:dragon-flag']=movement('dragon-flag','Dragon flag · supported shoulders',frames)
    result['diagram:dragon-flag']['labels']=['Raised','Lowered']
    frames=[]
    for raised in (False,True):
        foot='173,206 206,181' if raised else '173,206 214,206'
        frames.append(floor+line('83,29 83,209',grey,7)+circle(108,51)+line('111,70 135,135')+line('117,82 145,115 133,139')+line('135,135 153,174 173,206')+line(foot,green)+f'<path d="M232 201Q239 186 220 172" fill="none" stroke="{green}" stroke-width="3" marker-end="url(#arrow)"/>')
    result['diagram:tibialis-raise']=movement('tibialis-raise','Tibialis raise · heels down, toes up',frames)
    frames=[]
    for raised in (False,True):
        arm='175,85 215,89 264,94' if raised else '175,85 195,117 209,148'
        hand='264,94' if raised else '209,148'
        frames.append(floor+line('86,35 86,210',grey,6)+line('96,209 '+hand,grey,2)+circle(153,53)+line('157,72 178,136')+line('144,83 116,70 86,66')+line('178,136 167,175 153,207')+line('178,136 199,173 209,207')+line(arm,green))
    result['diagram:lean-away-cable-lateral']=movement('lean-away-cable-lateral','Lean-away cable lateral raise',frames)
    frames=[]
    for tucked in (False,True):
        legs='153,132 196,101 196,144' if tucked else '153,138 213,138 213,185'
        frames.append(line('85,27 233,27',grey,7)+circle(148,62,9)+line('137,81 120,28')+line('160,81 179,28')+line('148,81 153,133')+line(legs,green)+f'<path d="M238 156Q251 128 227 107" fill="none" stroke="{green}" stroke-width="3" marker-end="url(#arrow)"/>')
    result['diagram:garhammer-raise']=movement('garhammer-raise','Garhammer raise · knees start raised',frames)
    result['diagram:garhammer-raise']['labels']=['Knees raised','Curl pelvis']
    areas={'shoulders':(110,68,140,25),'chest':(133,86,94,32),'back':(133,83,94,65),'waist':(147,120,66,35),'upper legs':(134,159,92,44),'lower legs':(135,198,90,24),'upper arms':(108,91,144,34),'lower arms':(102,123,156,35),'neck':(164,51,32,22),'cardio':(129,66,102,155),'other':(129,66,102,155)}
    for area,(x,y,w,h) in areas.items():
        body=circle(180,37,18)+line('180,60 180,138',grey,25)+line('158,72 130,97 116,151',grey,16)+line('202,72 230,97 244,151',grey,16)+line('180,138 152,175 144,215',grey,18)+line('180,138 208,175 216,215',grey,18)+f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{green}" opacity=".55"/>'
        path=OUT/'areas'/f'{area.replace(" ","-")}.svg';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(svg('Target-area guide · '+area,body),encoding='utf-8')
    return result


if __name__=='__main__':
    build();print('Built six original movement references and target-area guides.')
