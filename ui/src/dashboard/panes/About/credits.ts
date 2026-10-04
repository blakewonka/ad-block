/**
 * Static content of the About pane (dashboard-shell.md §4.1, §4.2).
 * Link texts come from existing i18n keys; the credits are hard-coded English
 * exactly as upstream (`EXT/dashboard.html:186-191`, joining word " by ").
 */

export interface AboutLink {
    key: string;
    href: string;
}

/** Rows 3-6 of §4.1. */
export const TOP_LINKS: readonly AboutLink[] = [
    { key: 'aboutPrivacyPolicy', href: 'https://github.com/uBlockOrigin/uBOL-home/wiki/Privacy-policy' },
    { key: 'aboutDocumentation', href: 'https://github.com/uBlockOrigin/uBOL-home/wiki' },
    { key: 'aboutChangelog', href: 'https://github.com/uBlockOrigin/uBOL-home/releases' },
    { key: 'aboutCode', href: 'https://github.com/gorhill/uBlock' },
];

/** Row 7a-7c of §4.1 (under the `aboutContributors` heading). */
export const CONTRIBUTOR_LINKS: readonly AboutLink[] = [
    { key: 'aboutSourceCode', href: 'https://github.com/gorhill/uBlock/graphs/contributors' },
    { key: 'aboutTranslations', href: 'https://crowdin.com/project/ublock' },
    { key: 'aboutFilterLists', href: 'https://github.com/uBlockOrigin/uAssets/graphs/contributors' },
];

export interface Credit {
    work: string;
    workHref: string;
    author: string;
    authorHref: string;
}

/** Upstream's six credits, verbatim (§4.2). */
export const UPSTREAM_CREDITS: readonly Credit[] = [
    { work: 'Inter font family', workHref: 'https://github.com/rsms/inter', author: 'Rasmus Andersson', authorHref: 'https://github.com/rsms' },
    { work: 'FontAwesome font family', workHref: 'https://fontawesome.com/', author: 'Dave Gandy', authorHref: 'https://github.com/davegandy' },
    { work: 'Punycode.js', workHref: 'https://github.com/mathiasbynens/punycode.js', author: 'Mathias Bynens', authorHref: 'https://github.com/mathiasbynens' },
    { work: 'Flags of the World', workHref: 'https://flagpedia.net/', author: 'David Krmela', authorHref: 'https://www.davidkrmela.com/' },
    { work: 'CodeMirror 6', workHref: 'https://codemirror.net/', author: 'Marijn Haverbeke', authorHref: 'https://github.com/marijnh' },
    {
        work: 'google-ima3-dai',
        workHref: 'https://github.com/AdguardTeam/Scriptlets/blob/master/src/redirects/google-ima3-dai.ts',
        author: 'Adam Wróblewski',
        authorHref: 'https://github.com/AdamWr',
    },
];

/**
 * The libraries the new interface is built with (all MIT, GPLv3-compatible;
 * names and holders from each package's LICENSE in node_modules).
 */
export const UI_CREDITS: readonly Credit[] = [
    { work: 'React', workHref: 'https://react.dev/', author: 'Meta Platforms, Inc.', authorHref: 'https://github.com/facebook' },
    { work: 'Radix Primitives', workHref: 'https://www.radix-ui.com/primitives', author: 'WorkOS', authorHref: 'https://github.com/workos' },
    { work: 'Tailwind CSS', workHref: 'https://tailwindcss.com/', author: 'Tailwind Labs', authorHref: 'https://github.com/tailwindlabs' },
    { work: 'Apps SDK UI', workHref: 'https://github.com/openai/apps-sdk-ui', author: 'OpenAI', authorHref: 'https://github.com/openai' },
];

/** Row 2 of §4.1: hard-coded, not translated. */
export const COPYRIGHT_LINE = 'Copyright (c) Raymond Hill 2014-present';

/** Shown under the copyright line: who redesigned the interface. Hard-coded, not translated. */
export const REDESIGN_LINES: readonly string[] = ['Redesign: blakewonka', 'Design system: OpenAI'];
