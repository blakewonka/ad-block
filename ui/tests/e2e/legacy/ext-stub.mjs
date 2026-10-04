/**
 * Minimal WebExtension API stub so the UPSTREAM vanilla pages (classic
 * dashboard, overlays, report, matched-rules, strictblock, classic popup) can
 * render from a plain http://127.0.0.1 server. Test-only; used by
 * tests/e2e/legacy-css.mjs.
 *
 * `installExtStub` is serialised with Function.prototype.toString() and run as
 * a Playwright init script in every frame (pages, overlay iframes and the
 * overlay host page that plays the content-script side), so it must be
 * self-contained: no closures over module scope.
 */

/* eslint-disable no-undef */
export function installExtStub(DATA) {
    if (globalThis.browser && globalThis.browser.__legacyStub) { return; }
    const listeners = () => ({ addListener() {}, removeListener() {}, hasListener() { return false; } });
    const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    const area = obj => ({
        async get(keys) {
            if (keys === null || keys === undefined) { return clone(obj); }
            const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const out = {};
            for (const k of list) {
                if (k in obj) { out[k] = clone(obj[k]); }
                else if (keys && typeof keys === 'object' && !Array.isArray(keys)) { out[k] = keys[k]; }
            }
            return out;
        },
        async set(items) { Object.assign(obj, clone(items)); },
        async remove(keys) { for (const k of [].concat(keys)) { delete obj[k]; } },
        async clear() { for (const k of Object.keys(obj)) { delete obj[k]; } },
        async getKeys() { return Object.keys(obj); },
        onChanged: listeners(),
    });
    const local = clone(DATA.storage || {});
    const respond = msg => {
        switch (msg && msg.what) {
        case 'getOptionsPageData':
            return { ...DATA.optionsPageData, rulesetDetails: DATA.rulesetDetails };
        case 'getRulesetDetails':
            return DATA.rulesetDetails;
        case 'getEnabledRulesets':
            return DATA.optionsPageData.enabledRulesets;
        case 'getEnabledRulesetsDetails':
            return DATA.rulesetDetails.filter(d => DATA.optionsPageData.enabledRulesets.includes(d.id));
        case 'getAllCustomFilters':
            return DATA.customFilters;
        case 'customFiltersFromHostname':
            return DATA.customFilters[0][1];
        case 'getFilteringModeDetails':
            return DATA.filteringModes;
        case 'getDefaultConfig':
        case 'getCurrentConfig':
            return DATA.config;
        case 'getMatchedRules':
            return DATA.matchedRules;
        case 'popupPanelData':
            return DATA.popupPanelData;
        case 'getEffectiveUserRules':
        case 'getSandboxFilters':
            return '';
        case 'getAllDynamicRules':
        case 'getAllSessionRules':
        case 'getRegisteredContentScripts':
            return [];
        case 'getConsoleOutput':
            return [];
        case 'hasBroadHostPermissions':
            return true;
        case 'insertCSS': {
            // The background answers with scripting.insertCSS into the sender
            // tab; here the sender is this document (the overlay host page).
            const style = document.createElement('style');
            style.dataset.legacyStubCss = '';
            style.textContent = msg.css;
            (document.head || document.documentElement).append(style);
            return undefined;
        }
        case 'removeCSS':
            for (const el of document.querySelectorAll('style[data-legacy-stub-css]')) {
                if (el.textContent === msg.css) { el.remove(); }
            }
            return undefined;
        default:
            return undefined;
        }
    };
    const browser = {
        __legacyStub: true,
        runtime: {
            id: 'legacy-stub',
            getURL: p => new URL(String(p).replace(/^\//, ''), `${location.origin}/`).href,
            sendMessage: async msg => respond(msg),
            getManifest: () => DATA.manifest,
            onMessage: listeners(),
            onConnect: listeners(),
            lastError: undefined,
        },
        i18n: {
            getMessage(key) {
                if (key === '@@extension_id') { return location.hostname; }
                if (key === '@@ui_locale') { return 'en'; }
                if (key === '@@bidi_dir') { return 'ltr'; }
                const entry = DATA.messages[key];
                return entry ? entry.message : '';
            },
            getUILanguage: () => 'en',
        },
        storage: {
            local: area(local),
            session: area({}),
            sync: area({}),
            managed: area({}),
            onChanged: listeners(),
        },
        windows: {
            WINDOW_ID_NONE: -1,
            onFocusChanged: listeners(),
            async get() { return {}; },
            async create() { return {}; },
        },
        tabs: {
            async query() { return DATA.tab ? [clone(DATA.tab)] : []; },
            async create() { return {}; },
            async update() { return {}; },
            async reload() {},
            onUpdated: listeners(),
            onActivated: listeners(),
            onRemoved: listeners(),
        },
        permissions: {
            async contains() { return true; },
            async request() { return true; },
            async getAll() { return { origins: ['<all_urls>'], permissions: [] }; },
            onAdded: listeners(),
            onRemoved: listeners(),
        },
        declarativeNetRequest: {
            async getEnabledRulesets() { return DATA.optionsPageData.enabledRulesets; },
            async updateEnabledRulesets() {},
            async getDynamicRules() { return []; },
            async getSessionRules() { return []; },
            async getMatchedRules() { return { rulesMatchedInfo: [] }; },
        },
    };
    Object.defineProperty(globalThis, 'browser', { value: browser, configurable: true, writable: true });
}

/** Sample data used by the stub (deterministic). */
export function stubData({ messages, rulesetDetails, manifest }) {
    return {
        messages,
        rulesetDetails,
        manifest,
        storage: {},
        optionsPageData: {
            hasOmnipotence: true,
            defaultFilteringMode: 2,
            enabledRulesets: ['ublock-filters', 'easylist', 'easyprivacy'],
            adminRulesets: [],
            maxNumberOfEnabledRulesets: 50,
            autoReload: true,
            showBlockedCount: true,
            canShowBlockedCount: true,
            strictBlockMode: false,
            popupBlockMode: true,
            firstRun: false,
            isSideloaded: true,
            developerMode: true,
            supportsCompiledFilters: false,
            supportsUserScripts: false,
        },
        customFilters: [
            ['127.0.0.1', ['.ad-banner', '#sidebar > .promo', 'div[data-sponsored]']],
            ['news.example.org', ['.cookie-wall', 'aside.newsletter']],
        ],
        filteringModes: {
            none: ['intranet.example'],
            basic: ['www.example.com', 'docs.example.net'],
            optimal: ['all-urls'],
            complete: ['shop.example.org'],
        },
        config: { autoReload: true, developerMode: true, showBlockedCount: true, strictBlockMode: false, rulesets: ['ublock-filters', 'easylist', 'easyprivacy'] },
        // Classic popup (popup.html in the PRISTINE copy): the active tab and its panel data.
        tab: { id: 7, url: 'https://www.example.com/news', active: true, windowId: 1 },
        popupPanelData: {
            level: 2, autoReload: true, hasOmnipotence: true, hasGreatPowers: true, isSideloaded: true,
            developerMode: true, disabledFeatures: [], tabId: 7, tabURL: 'https://www.example.com/news',
            tabHostname: 'www.example.com', permissionsHint: false, showBlockedCount: true, hasCustomFilters: true,
        },
        matchedRules: [
            { request: { url: 'ads.example.com/banner.js', type: 'script', tabId: 7 }, rule: { ruleId: 1204, rulesetId: 'easylist' } },
            { request: { url: 'tracker.example.net/pixel.gif', type: 'image', tabId: 7 }, rule: { ruleId: 88, rulesetId: 'easyprivacy' } },
            { request: { url: 'cdn.example.org/widget.js', type: 'script', tabId: 7 }, rule: { ruleId: 3, rulesetId: 'ublock-filters' } },
        ],
    };
}
