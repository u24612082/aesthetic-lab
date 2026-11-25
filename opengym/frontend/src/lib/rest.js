import { exOr } from './exercises.js'

// Starting suggestions, not a measurement of recovery. Explicit per-exercise choices win.
export function restPrescription(S,entry,set={}) {
 const ex=exOr(entry.id),name=ex.n.toLowerCase()
 const override=S.restOverrides?.[entry.id] ?? entry.target?.restSec
 if(Number.isFinite(override)&&override>=30&&override<=600)return {seconds:override,reason:'Your exercise rest setting',exercise:ex.n}
 const isolation=/fly|pec deck|lateral|front raise|straight.arm|pullover|extension|curl|kickback|abduction|tibialis|calf|crunch|serratus|leg raise|garhammer|dragon flag/.test(name)
 const lower=/squat|leg press|deadlift|lunge|hip thrust/.test(name)
 const compound=!isolation&&/press|row|pulldown|pull.up|chin.up|squat|deadlift|lunge|thrust|dip/.test(name)
 let seconds=lower?180:compound?150:90
 let reason=lower?'Lower-body compound':compound?'Compound movement':'Isolation / accessory'
 if(compound&&set.r>0&&set.r<=6){seconds+=30;reason+=' · low-rep set'}
 const rir=set.rir ?? (set.rpe!=null?10-set.rpe:null)
 if(rir!=null&&rir<=1){seconds+=30;reason+=' · logged near failure'}
 return {seconds:Math.min(seconds,300),reason,exercise:ex.n}
}
