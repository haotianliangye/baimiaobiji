import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { initEmbeddingQueueListener } from './lib/embedding';

// Register PWA service worker
registerSW({ immediate: true });

// Initialize embedding queue listener
initEmbeddingQueueListener();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
