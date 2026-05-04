import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { Providers } from './app/Providers';
import { initSentry } from './lib/sentry';
import './index.css';

initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
