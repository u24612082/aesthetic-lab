#!/usr/bin/env python3
"""Build the redistributable local macro catalogue from the official USDA SR Legacy CSV ZIP."""
import argparse
import csv
import hashlib
import io
import json
import math
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parent.parent
URL='https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip'
NUTRIENTS={'1008':'kcal','1003':'protein','1005':'carbs','1004':'fat'}


def build(path):
    with ZipFile(path) as archive:
        def rows(name):
            member=next(n for n in archive.namelist() if n==name or n.endswith('/'+name))
            with archive.open(member) as f:yield from csv.DictReader(io.TextIOWrapper(f,encoding='utf-8-sig'))
        categories={r['id']:r['description'] for r in rows('food_category.csv')}
        foods={r['fdc_id']:r for r in rows('food.csv')}
        nutrients=defaultdict(dict);portions=defaultdict(list)
        for r in rows('food_nutrient.csv'):
            if r['nutrient_id'] in NUTRIENTS and r['amount']:
                nutrients[r['fdc_id']][NUTRIENTS[r['nutrient_id']]]=float(r['amount'])
        for r in rows('food_portion.csv'):
            if not r['gram_weight']:continue
            grams=float(r['gram_weight'])
            if not 0<grams<=10000:continue
            label=' '.join(p for p in (r['amount'],r['modifier'] or r['portion_description']) if p).strip()
            if label and len(portions[r['fdc_id']])<12:portions[r['fdc_id']].append({'label':label[:100],'grams':grams})
    output=[]
    popular=('Egg, whole, raw, fresh','Egg, whole, cooked, hard-boiled','Egg, white, raw, fresh',
             'Rice, white, long-grain, regular, enriched, cooked','Rice, white, long-grain, regular, enriched, uncooked',
             'Bananas, raw','Apples, raw, with skin','Avocados, raw, all commercial varieties','Oats',
             'Chicken, broilers or fryers, breast, skinless, boneless, meat only, raw',
             'Chicken, broilers or fryers, breast, meat only, cooked, roasted','Potatoes, flesh and skin, raw',
             'Sweet potato, raw, unprepared','Broccoli, raw','Oil, olive, salad or cooking',
             'Milk, whole, 3.25% milkfat, with added vitamin D','Butter, salted','Cheese, cheddar')
    friendly={'Egg, whole, raw, fresh':'Eggs · whole, raw','Egg, whole, cooked, hard-boiled':'Eggs · hard-boiled',
              'Egg, white, raw, fresh':'Egg whites · raw','Oats':'Oats · dry'}
    for fid,f in foods.items():
        n=nutrients[fid]
        if len(n)!=4 or not all(math.isfinite(v) and v>=0 for v in n.values()) or n['kcal']>1000 or any(n[k]>100 for k in ('protein','carbs','fat')):continue
        name=f['description'];lower=name.lower()
        basis='per 100 g edible portion'
        if 'raw' in lower:basis+=' · raw'
        elif 'uncooked' in lower:basis+=' · dry / uncooked'
        elif any(w in lower for w in ('cooked','roasted','boiled','fried','grilled','baked')):basis+=' · prepared as described'
        elif any(w in lower for w in ('dry','dehydrated')):basis+=' · dry / uncooked'
        output.append({'key':'usda-sr-'+fid,'name':friendly.get(name,name)[:200],'brand':'USDA reference',**n,'basis':basis,
                       'category':categories.get(f['food_category_id'],'Other'),'featured':int(name in popular),
                       'portions':portions[fid], 'source_url':f'https://fdc.nal.usda.gov/food-details/{fid}/nutrients',
                       'search_terms':name.lower().replace('yogurt','yoghurt yogurt')+' '+('eggs' if name.startswith('Egg,') else ''),
                       'provenance':'USDA FoodData Central · SR Legacy April 2018 · generic reference, not a South African pack label'})
    (ROOT/'aesthetic_lab/data/usda_foods.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n')
    meta={'source':URL,'release':'SR Legacy April 2018','sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),'foods':len(output),
          'nutrition_basis':'per 100 g edible portion','nutrient_ids':NUTRIENTS,'license':'USDA public-domain reference data'}
    (ROOT/'aesthetic_lab/data/usda_provenance.json').write_text(json.dumps(meta,indent=2)+'\n',encoding='utf-8')
    print(f'Built {len(output)} foods with complete energy/protein/carbohydrate/fat values and available gram-based portions.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('zipfile',type=Path);build(parser.parse_args().zipfile)
