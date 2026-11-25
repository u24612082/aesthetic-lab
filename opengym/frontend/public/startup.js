// Runs before the app's module graph, including when a cached script is missing.
// Recovery never clears website data, workout journals, cookies or food queues.
;(function(){
 var ready=false,timer
 function fail(message){
  if(ready)return
  var panel=document.getElementById('app-startup')
  if(!panel)return
  panel.hidden=false;panel.style.display='block';panel.setAttribute('role','alert')
  document.getElementById('app-startup-message').textContent=message||'The gym app could not finish opening.'
  document.getElementById('app-startup-help').hidden=false
  var retry=document.getElementById('app-startup-retry');retry.hidden=false;retry.style.display='inline-block'
 }
 window.__aestheticStartup={
  ready:function(){ready=true;clearTimeout(timer);var panel=document.getElementById('app-startup');if(panel){panel.hidden=true;panel.style.display='none'}},
  fail:fail
 }
 window.addEventListener('error',function(event){
  if(event.target===window||event.target?.tagName==='SCRIPT')fail('The app could not load a required file. Reload to retry.')
 },true)
 window.addEventListener('unhandledrejection',function(){fail('The gym app could not finish opening. Reload to retry.')})
 window.addEventListener('pageshow',function(){if(!ready){clearTimeout(timer);timer=setTimeout(function(){fail('Opening your saved log is taking longer than expected.')},10000)}})
 timer=setTimeout(function(){fail('Opening your saved log is taking longer than expected.')},10000)
})()
