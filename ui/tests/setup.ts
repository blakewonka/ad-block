/**
 * vitest setup: jest-dom matchers + DOM cleanup.
 * Loaded before every unit-test file (see vitest.config.ts -> test.setupFiles).
 */
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
    cleanup();
});
