import './lib/hardenStorage'; // must be first — makes localStorage best-effort before any module reads it
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// StrictMode intentionally double-invokes effects in dev, which fires Gemini twice
// and can leave ghost component states visible. Remove it for this Electron app.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
