export function waitForStorage(promise,milliseconds=8000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Phone storage did not respond. Close other tabs for this app and reload. Your saved entries have not been cleared.')),milliseconds)
  promise.then(value=>{clearTimeout(timer);resolve(value)},error=>{clearTimeout(timer);reject(error)})
 })
}
