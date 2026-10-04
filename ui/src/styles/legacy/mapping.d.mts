export interface KeptEntry { kind: 'kept' }
export interface LibEntry {
    kind: 'lib';
    lightToken: string;
    darkToken: string;
    dark: boolean;
    format: 'color' | 'triplet' | 'raw' | { alpha: number };
}
export const KEPT: KeptEntry;
export const MAPPING: Array<[string, KeptEntry | LibEntry]>;
export const PALETTE_NAMES: string[];
export const COLLIDING_NAMES: string[];
export const TRIPLET_BY_REFERENCE: string[];
