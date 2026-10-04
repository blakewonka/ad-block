/**
 * Entry of the toolbar popup (popup.html).
 *
 * Kept deliberately small: it links the stylesheet (static import, so the built
 * popup.html loads it render-blocking from <head>), registers the mount guard's window
 * error listeners, and only THEN loads the app with a dynamic import. So an exception
 * while the app modules are evaluated, a chunk that cannot be loaded, or a render error
 * all end in `location.replace('popup-classic.html')` (UI rule §6.9).
 */
import '@/styles/app.css';

import { createMountGuard } from './fallback';

const guard = createMountGuard(window);

import('./mount')
    .then(({ mountPopup }) => mountPopup(guard))
    .catch((err: unknown) => guard.fallBack(err));
