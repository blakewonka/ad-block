export class LegacyCssError extends Error {}
export function normalizeSpace(s: string): string;
export function parseColor(text: string): { r: number; g: number; b: number; a: number } | null;
export function collectLibraryThemes(cssTexts: string[]): { light: Map<string, string>; dark: Map<string, string> };
export function resolveLibraryToken(token: string, themeMap: Map<string, string>, format?: 'color' | 'triplet' | 'raw' | { alpha: number }): string;
export function parseUpstream(cssText: string): {
    names: string[];
    rootValues: Map<string, string>;
    light: Map<string, string>;
    dark: Map<string, string>;
};
export interface GeneratorInputs {
    libraryCss: string[];
    upstreamCss: string;
    codemirrorCss: string;
    focusCss: string;
    embedLayoutCss: string;
    embedCss: string;
    libraryVersion?: string;
}
export function generateLegacyCss(input: GeneratorInputs): { css: string; light: Map<string, string>; dark: Map<string, string> };
