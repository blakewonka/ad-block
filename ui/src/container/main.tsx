/**
 * Entry of the macOS container-app window -> dist/container/Script.js (one
 * classic IIFE, loaded by container/Main.html with <script src="../Script.js" defer>).
 * Spec: docs/specs/container.md (§11 implementation recommendation: React IIFE).
 *
 * IMPORT ORDER IS LOAD-BEARING: ./native must stay the FIRST import. It has no
 * imports itself and, at evaluation, assigns `window.show` and sets
 * html[data-theme] — before React, react-dom's scheduler and the library
 * initialise (Swift may call show() before React mounts; spec §4.4.1).
 *
 * Never import src/lib/ext.ts, bridge.ts, i18n.tsx or src/dev/* here: this page
 * has no extension API (spec §10, §11.2.14).
 */
import './native';

import '@/styles/app.css';
import './container.css';

import { mount } from './mount';

mount(document.getElementById('root'));
