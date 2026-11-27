import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './native-links.js'
import { applyPrefs, loadPrefs } from './theme.js'

// Apply saved display settings (theme, accent, text size) before first paint.
applyPrefs(loadPrefs())
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
