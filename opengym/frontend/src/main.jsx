import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import {ensureOfflineShell} from './lib/offline-shell.js'
import './index.css'
import StartupRecovery from './components/StartupRecovery.jsx'

// The route boundary cannot catch a failure in the shell, timers, or sheets.
class AppBoundary extends Component {
 state={failed:false}
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(error){console.error('Aesthetic Lab app error:',error);window.__aestheticStartup?.ready()}
 render(){return this.state.failed?<StartupRecovery/>:this.props.children}
}

createRoot(document.getElementById('root')).render(
  <StrictMode><AppBoundary><App /></AppBoundary></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if(!MOBILE)void ensureOfflineShell().catch(()=>{})
