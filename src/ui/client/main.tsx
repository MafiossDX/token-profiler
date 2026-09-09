import { render } from 'preact';
import './styles.css';
import { App } from './app.tsx';

// Vite entry (ADR-0015). Bundled to dist/ui/assets/*.js|css and mounted into
// the #app node of dist/ui/index.html, which src/ui/server.ts serves.
const root = document.getElementById('app');
if (root) render(<App />, root);
