import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { OAuthCallbackPage } from './components/common/OAuthCallbackPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === '/oauth/callback' ? <OAuthCallbackPage /> : <App />}
  </StrictMode>,
)
