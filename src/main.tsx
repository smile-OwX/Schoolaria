import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {applySchoolThemeToDocument, getSavedPreviewTheme} from './lib/schoolTheme.ts';

applySchoolThemeToDocument(getSavedPreviewTheme());

createRoot(document.getElementById('root')!).render(<App />);
