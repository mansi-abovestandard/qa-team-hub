import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { ToastProvider } from './ui.jsx'
import { initTheme } from './theme.jsx'
import './styles.css'

initTheme()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider><App /></ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
)
