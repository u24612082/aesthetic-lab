import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const source=readFileSync(new URL('../../public/startup.js',import.meta.url),'utf8')
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers())
function startup(){
 const elements=Object.fromEntries(['app-startup','app-startup-message','app-startup-help','app-startup-retry'].map(id=>[id,{hidden:id.includes('help')||id.includes('retry'),style:{},setAttribute:vi.fn()}]))
 const listeners={},window={addEventListener:(type,fn)=>listeners[type]=fn}
 runInNewContext(source,{window,document:{getElementById:id=>elements[id]},setTimeout,clearTimeout})
 return {elements,listeners,window}
}
it('shows usable recovery before React when a required app script cannot load',()=>{
 const {elements,listeners}=startup();listeners.error({target:{tagName:'SCRIPT'}})
 expect(elements['app-startup-retry'].hidden).toBe(false)
 expect(elements['app-startup-message'].textContent).toContain('required file')
})
it('replaces an indefinite startup wait with a reload action',async()=>{
 const {elements}=startup();await vi.advanceTimersByTimeAsync(10000)
 expect(elements['app-startup-help'].hidden).toBe(false)
 expect(elements['app-startup-retry'].style.display).toBe('inline-block')
})
it('keeps the fallback hidden after the real app has rendered, including on resume',async()=>{
 const {elements,listeners,window}=startup();window.__aestheticStartup.ready();listeners.pageshow()
 await vi.advanceTimersByTimeAsync(20000)
 expect(elements['app-startup'].style.display).toBe('none')
})
