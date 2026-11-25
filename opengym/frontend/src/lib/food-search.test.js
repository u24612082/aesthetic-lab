import {describe,it,expect} from 'vitest'
import {rankFoods} from '../../../../aesthetic_lab/static/food-search.js'
const rows=[{id:1,name:'Babyfood, dinner, spaghetti',brand:'USDA'},{id:2,name:'Spaghetti, dry, enriched',brand:'USDA'},{id:3,name:'Spaghetti, cooked',brand:'USDA'},{id:4,name:'Premium Mass Anabolic Muscle Builder',brand:'Nutritech'},{id:5,name:'Beef, ground, raw',brand:'USDA'}]
describe('offline food discovery',()=>{
 it('puts plain pasta ahead of baby food for common spellings',()=>{for(const q of ['spaghetti','spagetti','pasta'])expect(rankFoods(rows,q).slice(0,2).map(f=>f.id)).toEqual([3,2])})
 it('maps everyday spaghetti to plain USDA pasta before fortified/restaurant dishes',()=>{const foods=[{id:6,name:'Pasta, cooked, enriched',brand:'USDA',category:'Cereal Grains and Pasta'},{id:7,name:"DENNY’S, spaghetti and meatballs",brand:'USDA',category:'Restaurant Foods'},{id:8,name:'Spaghetti, protein-fortified, cooked',brand:'USDA'}];expect(rankFoods(foods,'spagetti')[0].id).toBe(6)})
 it('matches the requested brand shorthand and mince vocabulary',()=>{expect(rankFoods(rows,'nutritec mass gainer')[0].id).toBe(4);expect(rankFoods(rows,'beef mince')[0].id).toBe(5)})
 it('keeps saved categories and recent scopes local',()=>{expect(rankFoods(rows,'','recent','',new Map([[3,1]])).map(f=>f.id)).toEqual([3]);expect(rankFoods(rows,'','favorites')).toEqual([])})
 it('keeps plan foods downloadable and searchable alongside the whole catalogue',()=>{
  const foods=[...rows,{id:9,name:'Coco Pops Original',brand:"Kellogg's",plan_food:true,plan_order:0,search_terms:'coco pops cereal'},
   {id:10,name:'Rice, cooked',brand:'USDA',plan_food:true,plan_order:1}]
  expect(rankFoods(foods,'','plan').map(f=>f.id)).toEqual([9,10])
  expect(rankFoods(foods,'cocopops')[0].id).toBe(9)
  expect(rankFoods(foods,'spaghetti').some(f=>f.id===3)).toBe(true)
  expect(rankFoods(foods,'','favorites')).toEqual([])
 })
})
