import { registerSW } from 'virtual:pwa-register';
import './styles/index.css';
import { App } from './app/App';

void App.start();

// Offline support: the service worker precaches the app and updates itself in the background.
if ('serviceWorker' in navigator) registerSW({ immediate: true });
