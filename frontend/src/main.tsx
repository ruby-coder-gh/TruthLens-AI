import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Error boundary to catch render failures
window.addEventListener('error', (e) => {
  const root = document.getElementById('root')
  if (root) {
    // Standalone last-resort screen: React has failed, so no token, class or
    // component from the app is available here. Grounded Glass light values are
    // inlined deliberately.
    root.innerHTML = `<div style="padding:2rem;color:#1F2328;background:#FAFAF9;min-height:100vh;font-family:Inter,system-ui,sans-serif">
      <h1 style="color:#B91C1C">Render Error</h1>
      <pre style="color:#9A4508;margin-top:1rem;overflow:auto">${e.error?.stack || e.message || 'Unknown error'}</pre>
      <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#4F46E5;color:#FFFFFF;border:none;border-radius:10px;cursor:pointer">Reload</button>
    </div>`
  }
})

createRoot(document.getElementById('root')!).render(
  <App />,
)
