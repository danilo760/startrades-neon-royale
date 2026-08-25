import React from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './overlay/Overlay.jsx';
import { Control } from './control/Control.jsx';
import './styles.css';
createRoot(document.getElementById('root')).render(location.pathname.startsWith('/control') ? <Control /> : <Overlay />);
