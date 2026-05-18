import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({
  immediate: true,
  onOfflineReady() {
    // App lista para uso sin conexión (activos estáticos en caché).
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
