import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { InAppNoticeProvider } from './components/InAppNotice'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InAppNoticeProvider>
      <App />
    </InAppNoticeProvider>
  </React.StrictMode>
)
