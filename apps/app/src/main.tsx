import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import './index.css'
import { i18nReady } from './i18n'

// Gate first render on i18n readiness so the detected locale and
// document.dir/lang are settled before any component calls useTranslation().
// With initImmediate:false and bundled resources this resolves in the same
// microtask tick — no visible blank flash.
i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
