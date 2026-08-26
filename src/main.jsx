import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const Overlay = lazy(() =>
  import('./overlay/Overlay.jsx').then((module) => ({
    default: module.Overlay,
  }))
);

const Control = lazy(() =>
  import('./control/Control.jsx').then((module) => ({
    default: module.Control,
  }))
);

createRoot(document.getElementById('root')).render(
  <Suspense fallback={<div>Loading...</div>}>
    {location.pathname.startsWith('/control') ? <Control /> : <Overlay />}
  </Suspense>
);
