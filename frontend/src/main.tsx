import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Error boundary to catch render failures
window.addEventListener('error', (e) => {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `<div style="padding:2rem;color:#e8edf5;background:#14150f;min-height:100vh;font-family:sans-serif">
      <h1 style="color:#f87171">Render Error</h1>
      <pre style="color:#fbbf24;margin-top:1rem;overflow:auto">${e.error?.stack || e.message || 'Unknown error'}</pre>
      <button onclick="location.reload()" style="margin-top:1rem;padding:0.5rem 1rem;background:#e8c15a;color:#14150f;border:none;border-radius:8px;cursor:pointer">Reload</button>
    </div>`
  }
})

createRoot(document.getElementById('root')!).render(
  <App />,
)
