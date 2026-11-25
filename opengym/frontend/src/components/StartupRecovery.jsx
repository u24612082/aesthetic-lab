export default function StartupRecovery({message}){
 return <main className="narrow" style={{padding:'20vh 20px 40px'}} role="alert">
  <h1>Let’s reopen your gym log</h1>
  <p>{message||'This screen could not finish opening.'}</p>
  <p className="muted">Reload to try again. Your saved workout and food entries will be kept on this device.</p>
  <button type="button" className="btn primary" onClick={()=>location.reload()}>Reload app</button>
 </main>
}
