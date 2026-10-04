/**
 * Plain-DOM fallback of the container window (docs/specs/container.md §11.2.11).
 *
 * Used only when React fails to mount (createRoot/render throws, an error
 * boundary catches, or a window `error` fires before mount). There is no
 * classic page to fall back to (only Main.html/Script.js/Style.css ship) and
 * the page must never navigate, so the same content is rebuilt here with
 * createElement + textContent only (no innerHTML, no style attribute), and
 * keeps following the store, so later show() calls still update it.
 *
 * Class names are complete static strings (Tailwind scans src/).
 */
import { ICON_ALT, ICON_SIZE, ICON_SRC, LAYOUT, PRODUCT_NAME, viewModel } from './texts';
import { getState, openPreferences, subscribe } from './native';

let active: { container: HTMLElement; dispose: () => void } | null = null;

/** True once the fallback has been rendered. */
export function isFallbackActive(): boolean {
    return active !== null;
}

/**
 * Replaces the content of `container` with the plain-DOM page. Idempotent:
 * a second call for the same container does nothing. Returns a disposer.
 */
export function renderFallback(container: HTMLElement): () => void {
    if (active !== null && active.container === container) return active.dispose;
    active?.dispose();

    const doc = container.ownerDocument;
    const main = doc.createElement('main');
    main.className = LAYOUT.main;
    main.setAttribute('data-container-fallback', '');

    const img = doc.createElement('img');
    img.src = ICON_SRC;
    img.alt = ICON_ALT;
    img.width = ICON_SIZE;
    img.height = ICON_SIZE;
    img.draggable = false;
    img.className = LAYOUT.icon;

    const group = doc.createElement('div');
    group.className = LAYOUT.group;
    const heading = doc.createElement('h1');
    heading.className = LAYOUT.heading;
    heading.textContent = PRODUCT_NAME;
    const status = doc.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.className = LAYOUT.status;
    const paragraph = doc.createElement('p');
    paragraph.className = LAYOUT.sentence;
    status.append(paragraph);
    group.append(heading, status);

    const button = doc.createElement('button');
    button.type = 'button';
    button.className = LAYOUT.fallbackButton;
    button.addEventListener('click', () => openPreferences());

    main.append(img, group, button);

    const update = (): void => {
        const vm = viewModel(getState());
        main.setAttribute('data-state', vm.kind);
        if (paragraph.textContent !== vm.status) paragraph.textContent = vm.status;
        if (button.textContent !== vm.button) button.textContent = vm.button;
    };
    update();
    const unsubscribe = subscribe(update);
    container.replaceChildren(main);

    const dispose = (): void => {
        unsubscribe();
        if (active?.container === container) active = null;
    };
    active = { container, dispose };
    return dispose;
}
