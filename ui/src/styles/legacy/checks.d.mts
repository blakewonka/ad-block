export const MEDIA_DARK: string;
export const MEDIA_CONTRAST: string;
export const EMBED_SELECTORS: string[];
export const EMBED_LAYOUT_RULES: Record<string, string>;
export function blockOfRule(rule: unknown): 'B6' | 'B7' | 'B8' | 'B9' | null;
export function parseSpecCssBlocks(markdown: string): { B7: string; B8: string; B9: string; B6: string };
export function cssBlocksOf(G: string): { B7: string; B8: string; B9: string; B6: string };
export interface CheckResult { id: string; ok: boolean; problems: string[] }
export function parseSpecTable(markdown: string): Array<{ name: string; light: string; dark: string | null }>;
export function checkLegacyCss(G: string, U: string, opts?: { specMarkdown?: string }): CheckResult[];
export function formatResults(results: CheckResult[]): string;
