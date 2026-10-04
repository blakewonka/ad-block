/**
 * icons — the one semantic icon map of the Blocker UI.
 *
 * Every icon the UI shows is picked here by MEANING (`icons.zapper`, `icons.trash`),
 * never by the library's file name at the call site, so a later swap is one line.
 *
 * Source: the library's Icon barrel. Its package `exports` map only exposes
 * `@openai/apps-sdk-ui/components/<Name>` (-> dist/es/components/<Name>/index.js), so
 * `@openai/apps-sdk-ui/components/Icon` is the deepest importable path: the per-icon
 * files under `Icon/svg/` are not reachable through the exports map. Every icon module
 * is a side-effect-free function component and the bundler drops the ones not named
 * below.
 *
 * Rules (UI rule §6.3): never add any `Openai*` logo icon; the unit test
 * icons.test.tsx fails if one appears in this map.
 *
 * Mapping notes (names that do not exist in the library are NOT guessed):
 * - zapper  = Bolt          (upstream fa-icon "bolt")
 * - picker  = EyeOff        (upstream fa-icon "eye-slash": hide an element)
 * - unpicker= Eye           (upstream fa-icon "eye-open": show hidden elements again)
 * - report  = Comment       (upstream fa-icon "comment-alt")
 * - dashboard = SettingsCog (upstream fa-icon "cogs")
 * - matchedRules = NotebookCheck (upstream fa-icon "list-alt"; the library has no "List";
 *                  "Order" read as a shopping bag)
 * - upload  = UploadDocuments (the library has no plain "Upload")
 */
import {
    ArrowLeft,
    ArrowRight,
    ArrowRotateCw,
    Book,
    Bolt,
    Bug,
    Check,
    CheckCircle,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    ChevronUpDown,
    Code,
    Comment,
    Copy,
    DotsHorizontal,
    Download,
    ExclamationMarkCircle,
    ExternalLink,
    Eye,
    EyeOff,
    Filter,
    Globe,
    History,
    Home,
    InfoCircle,
    Lock,
    Minus,
    NotebookCheck,
    Plus,
    QuestionMarkCircle,
    Reload,
    RestoreUntrash,
    Search,
    Settings,
    SettingsCog,
    SettingsSlider,
    ShieldCheck,
    Translate,
    Trash,
    Undo,
    UploadDocuments,
    Warning,
    X,
} from '@openai/apps-sdk-ui/components/Icon';
import type { JSX, SVGProps } from 'react';

/** Shape of every library icon: an <svg> component sized 1em x 1em, fill currentColor. */
export type IconComponent = (props: SVGProps<SVGSVGElement>) => JSX.Element;

export const icons = {
    // Popup tools and ribbon
    zapper: Bolt,
    picker: EyeOff,
    unpicker: Eye,
    report: Comment,
    dashboard: SettingsCog,
    matchedRules: NotebookCheck,

    // Navigation / disclosure
    home: Home,
    chevronDown: ChevronDown,
    chevronUp: ChevronUp,
    chevronLeft: ChevronLeft,
    chevronRight: ChevronRight,
    chevronUpDown: ChevronUpDown,
    arrowLeft: ArrowLeft,
    arrowRight: ArrowRight,
    externalLink: ExternalLink,
    more: DotsHorizontal,

    // Status
    check: Check,
    success: CheckCircle,
    warning: Warning,
    error: ExclamationMarkCircle,
    info: InfoCircle,
    help: QuestionMarkCircle,
    shield: ShieldCheck,
    lock: Lock,

    // Settings / dashboard panes
    settings: Settings,
    filterLists: Filter,
    customFilters: SettingsSlider,
    develop: Code,
    about: InfoCircle,
    docs: Book,
    bug: Bug,
    website: Globe,
    language: Translate,
    history: History,

    // Actions
    search: Search,
    close: X,
    add: Plus,
    remove: Minus,
    download: Download,
    upload: UploadDocuments,
    trash: Trash,
    restore: RestoreUntrash,
    copy: Copy,
    undo: Undo,
    reload: Reload,
    update: ArrowRotateCw,
} as const satisfies Record<string, IconComponent>;

export type IconName = keyof typeof icons;

/**
 * Icons whose meaning is a direction along the line of text: mirrored under dir="rtl"
 * (AppIcon / IconButton add `rtl:-scale-x-100`). External-link and undo/redo arrows
 * keep their shape, as platform guidelines recommend for those glyphs.
 */
export const MIRROR_IN_RTL: ReadonlySet<IconName> = new Set<IconName>([
    'chevronLeft',
    'chevronRight',
    'arrowLeft',
    'arrowRight',
]);

export function iconMirrorsInRtl(name: IconName): boolean {
    return MIRROR_IN_RTL.has(name);
}
