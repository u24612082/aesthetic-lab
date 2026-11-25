import {beforeEach,afterEach,it,expect,vi} from 'vitest'

beforeEach(()=>{vi.resetModules();vi.useFakeTimers()})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()})
async function app(){
 const listeners={}
 const worker={state:'activated',version:'first',addEventListener:vi.fn(),removeEventListener:vi.fn(),
  postMessage:(_message,ports)=>ports[0].reply({ready:true,version:worker.version})}
 const registration={active:worker,update:vi.fn().mockResolvedValue()}
 vi.stubGlobal('window',{isSecureContext:true,addEventListener:(name,fn)=>listeners['window:'+name]=fn})
 vi.stubGlobal('document',{querySelector:()=>({content:'first'}),addEventListener:vi.fn()})
 vi.stubGlobal('navigator',{serviceWorker:{getRegistration:vi.fn().mockResolvedValue(registration),addEventListener:(name,fn)=>listeners[name]=fn}})
 vi.stubGlobal('location',{reload:vi.fn()})
 vi.stubGlobal('MessageChannel',class{
  constructor(){this.port1={close:vi.fn(),onmessage:null};this.port2={reply:value=>queueMicrotask(()=>this.port1.onmessage?.({data:value}))}}
 })
 const shell=await import('./offline-shell.js')
 return {shell,worker,listeners,registration}
}
it('offers the newly installed version to an already-open cached app',async()=>{
 const {shell,worker,listeners}=await app();await shell.ensureOfflineShell()
 expect(shell.shellStatus().updateAvailable).toBe(false)
 worker.version='second';listeners.controllerchange()
 await vi.waitFor(()=>expect(shell.shellStatus().updateAvailable).toBe(true))
})
it('offers an already-active newer cache even when its controller event was missed',async()=>{
 const {shell,worker}=await app();worker.version='second'
 await shell.ensureOfflineShell()
 expect(shell.shellStatus().updateAvailable).toBe(true)
})
it('checks for an available cached update after the phone reconnects without changing routes',async()=>{
 const {shell,worker,listeners}=await app();await shell.ensureOfflineShell()
 worker.version='second';listeners['window:online']()
 await vi.waitFor(()=>expect(shell.shellStatus().updateAvailable).toBe(true))
})
it('can reload a complete downloaded update while disconnected without discarding pending saves',async()=>{
 const {shell,worker,registration}=await app();worker.version='second'
 registration.update.mockRejectedValue(Error('Mac unavailable'))
 const flush=vi.fn().mockResolvedValue(true)
 await shell.reloadOfflineApp(flush)
 expect(flush).toHaveBeenCalledTimes(2);expect(location.reload).toHaveBeenCalledOnce()
})
it('keeps the current page when offline and no different complete version was downloaded',async()=>{
 const {shell,registration}=await app();registration.update.mockRejectedValue(Error('Mac unavailable'))
 await expect(shell.reloadOfflineApp(vi.fn().mockResolvedValue(true))).rejects.toThrow('home Wi-Fi')
 expect(location.reload).not.toHaveBeenCalled()
})
it('confirms pending device saves before reloading the updated app',async()=>{
 const {shell}=await app();const flush=vi.fn().mockResolvedValue(true)
 await shell.reloadOfflineApp(flush)
 expect(flush).toHaveBeenCalledTimes(2);expect(location.reload).toHaveBeenCalledOnce()
})
it('retains the running page if its local save cannot be confirmed',async()=>{
 const {shell,registration}=await app()
 await expect(shell.reloadOfflineApp(vi.fn().mockResolvedValue(false))).rejects.toThrow('could not be saved')
 expect(location.reload).not.toHaveBeenCalled();expect(registration.update).not.toHaveBeenCalled()
})
