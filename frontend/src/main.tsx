import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Error boundary to catch render failures
window.addEventListener('error', (e) => {
  const root = document.getElementById('root')
  if (root) {
    // Standalone last-resort screen: React has failed, so no token, class or
    // component from the app is available here. Claim Ledger light values are
    // inlined deliberately.
    root.innerHTML = `<div style="padding:2rem;color:#15202B;background:#F2F4F1;min-height:100vh;font-family:'IBM Plex Sans',system-ui,sans-serif">
      <h1 style="color:#B42318">Render Error</h1>
      <pre style="color:#8A5300;margin-top:1rem;overflow:auto">${e.error?.stack || e.message || 'Unknown error'}</pre>
      <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#2350B5;color:#FFFFFF;border:none;border-radius:8px;cursor:pointer">Reload</button>
    </div>`
  }
})

createRoot(document.getElementById('root')!).render(
  <App />,
)
