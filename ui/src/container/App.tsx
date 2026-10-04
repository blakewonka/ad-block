/**
 * The container-app window (425 x 325 CSS px, not resizable; docs/specs/container.md).
 *
 * Icon, title, one status sentence for the current state (only the active one
 * is in the DOM, inside a polite live region), and the library Button that
 * asks Swift to open Safari's extension settings.
 *
 * The title "Blocker" is the only element beyond the upstream markup (spec
 * §6.1): Main.html has no <title> and its head is frozen (§11.2.12), so the
 * h1 is what names the document for assistive technology. It repeats the
 * window title. Upstream has no status dot and neither do we: the sentence
 * carries the state.
 */
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { useEffect, useSyncExternalStore } from 'react';

import { getState, openPreferences, subscribe } from './native';
import { ICON_ALT, ICON_SIZE, ICON_SRC, LAYOUT, PRODUCT_NAME, viewModel } from './texts';

export type ContainerAppProps = {
    /** Called once the tree has committed (used by mount() to stop the pre-mount error watch). */
    onMounted?: () => void;
};

export function ContainerApp({ onMounted }: ContainerAppProps) {
    const state = useSyncExternalStore(subscribe, getState, getState);
    const vm = viewModel(state);

    useEffect(() => {
        onMounted?.();
    }, [onMounted]);

    return (
        <main className={LAYOUT.main} data-state={vm.kind}>
            <img
                src={ICON_SRC}
                alt={ICON_ALT}
                width={ICON_SIZE}
                height={ICON_SIZE}
                draggable={false}
                className={LAYOUT.icon}
            />
            <div className={LAYOUT.group}>
                <h1 className={LAYOUT.heading}>{PRODUCT_NAME}</h1>
                <div role="status" aria-live="polite" aria-atomic="true" className={LAYOUT.status}>
                    <p className={LAYOUT.sentence}>{vm.status}</p>
                </div>
            </div>
            <Button color="primary" size="lg" type="button" className={LAYOUT.button} onClick={() => openPreferences()}>
                {vm.button}
            </Button>
        </main>
    );
}
