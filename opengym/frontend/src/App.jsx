import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import Admin from './views/Admin.jsx'
import PhoneSetup from './views/PhoneSetup.jsx'
import OfflineStatus from './components/OfflineStatus.jsx'
import Nutrition from './views/Nutrition.jsx'
import LabCoach from './views/LabCoach.jsx'
import Analytics from './views/Analytics.jsx'
import StartupRecovery from './components/StartupRecovery.jsx'
import './lab.css'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready, hydrated, startupError } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || 'en') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'en' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  useEffect(()=>{if(hydrated&&(authed||ready||startupError))window.__aestheticStartup?.ready()},[hydrated,authed,ready,startupError])
  if(startupError)return <StartupRecovery message={startupError}/>
  if (!hydrated || (!ready && !authed)) return (
    <div id="app">
      <div style={{padding:'20vh 24px 0',textAlign:'center'}} role="status"><Icon name="dumbbell"/><p>Opening your saved gym log…</p></div>
    </div>
  )

  return (
    <>
      <RestTimer />
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      {authed && <><div className="lab-top"><a href="#/home" className="lab-brand">AESTHETIC <b>LAB</b><small>{useStore.getState().config?.demo?'SYNTHETIC DEMO WORKSPACE':'POWERED BY OPENGYM'}</small></a><div className="lab-links">{[['nutrition','Nutrition'],['coach','Coach'],['analytics','Analytics']].map(([route,label])=><button key={route} aria-current={loc.pathname==='/'+route?'page':undefined} onClick={()=>{void useStore.getState().pushState();navigate('/'+route)}}>{label}</button>)}</div></div><OfflineStatus/></>}
      <div id="app" className={"vfade"+(["/nutrition","/coach","/analytics"].includes(loc.pathname)?" lab-main":"")} key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : (
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/phone" element={<PhoneSetup />} />
              {/* The Coach screens gate themselves on the instance config; the routes exist
                  unconditionally so a deep link from a notification lands somewhere sane
                  rather than on the catch-all. */}
              <Route path="/coach" element={<LabCoach />} />
              <Route path="/nutrition" element={<Nutrition />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      {authed && <div className="lab-source">Based on <a href="https://github.com/alexpcosta/opengym" target="_blank" rel="noopener noreferrer">OpenGym</a> · <a href="/api/source">Modified source · AGPL-3.0</a></div>}
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
