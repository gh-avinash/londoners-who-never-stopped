// Shared, collaborative state of the story. Kept deliberately tiny: everything else (animation
// progress, derived numbers) is reconstructed locally on each screen.
//
// 'auto' = the spotlight follows the playhead through the eras (see lib/story/timeline.ts).
export type Focus = 'auto' | 'all' | 'normal' | 'lockdown' | 'recovery' | 'whatif' | 'future';

export const FOCUSES: readonly Focus[] = [
    'auto',
    'all',
    'normal',
    'lockdown',
    'recovery',
    'whatif',
    'future'
];

// Visitors' phones may highlight stations, but never steer the wall.
export const MAX_PICKS = 6;

export type StoryState = {
    // Index into `StationsData.weeks` (Monday-start weeks, 2019 -> 2026).
    week: number;
    // When true the bus server advances `week` on its clock until `maxWeek`.
    playing: boolean;
    // True while the wall plays itself because nobody has touched a control for a while.
    attract: boolean;
    // Which section of the wall is spotlit; others dim.
    focus: Focus;
    // Station `id` highlighted by the presenter (map ring + detail card), or null.
    selected: string | null;
    // What-if simulator: 0 = what really happened in lockdown, 100 = the jobs-only model.
    whatIf: number;
    // Stations picked by visitors on their phones (newest last, at most MAX_PICKS).
    picks: string[];
};

export const INITIAL_STORY_STATE: StoryState = {
    week: 0,
    playing: false,
    attract: false,
    focus: 'auto',
    selected: null,
    whatIf: 0,
    picks: []
};

// Patch sent by a control client. `maxWeek` tells the server where playback must stop
// (the server never loads the dataset itself). `picks` and `attract` are server-owned.
export type StoryPatch = Partial<Omit<StoryState, 'picks' | 'attract'>> & { maxWeek?: number };

const MAX_WEEK_INDEX = 10_000;
const MAX_ID_LENGTH = 32;

export function isFocus(value: unknown): value is Focus {
    return typeof value === 'string' && (FOCUSES as readonly string[]).includes(value);
}

export function isStationId(value: unknown): value is string {
    return (
        typeof value === 'string' && value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9]+$/.test(value)
    );
}

// Validates an untrusted patch; unknown/invalid fields are dropped rather than rejected so a
// partially valid message still applies its good fields.
export function sanitizeStoryPatch(input: unknown): StoryPatch {
    if (typeof input !== 'object' || input === null) return {};
    const raw = input as Record<string, unknown>;
    const patch: StoryPatch = {};
    if (Number.isInteger(raw.week)) {
        patch.week = Math.min(MAX_WEEK_INDEX, Math.max(0, raw.week as number));
    }
    if (Number.isInteger(raw.maxWeek)) {
        patch.maxWeek = Math.min(MAX_WEEK_INDEX, Math.max(0, raw.maxWeek as number));
    }
    if (typeof raw.playing === 'boolean') patch.playing = raw.playing;
    if (isFocus(raw.focus)) patch.focus = raw.focus;
    if (raw.selected === null) patch.selected = null;
    if (isStationId(raw.selected)) patch.selected = raw.selected;
    if (Number.isInteger(raw.whatIf)) {
        patch.whatIf = Math.min(100, Math.max(0, raw.whatIf as number));
    }
    return patch;
}

export function sanitizeStoryState(input: unknown): StoryState | null {
    if (typeof input !== 'object' || input === null) return null;
    const raw = input as Record<string, unknown>;
    const patch = sanitizeStoryPatch(raw);
    if (patch.week === undefined || patch.playing === undefined || patch.focus === undefined) {
        return null;
    }
    return {
        week: patch.week,
        playing: patch.playing,
        attract: raw.attract === true,
        focus: patch.focus,
        selected: patch.selected ?? null,
        whatIf: patch.whatIf ?? 0,
        picks: Array.isArray(raw.picks) ? raw.picks.filter(isStationId).slice(-MAX_PICKS) : []
    };
}

// Live network snapshot polled by the bus server from TfL's open API.
export type LiveLine = { name: string; status: string; good: boolean };
export type LiveStatus = {
    // ISO timestamp of the TfL fetch (server clock).
    at: string;
    lines: LiveLine[];
    liftsOut: number;
};

export function sanitizeLiveStatus(input: unknown): LiveStatus | null {
    if (typeof input !== 'object' || input === null) return null;
    const raw = input as Partial<LiveStatus>;
    if (
        typeof raw.at !== 'string' ||
        !Array.isArray(raw.lines) ||
        typeof raw.liftsOut !== 'number'
    ) {
        return null;
    }
    const lines = raw.lines
        .filter(
            (l): l is LiveLine =>
                typeof l === 'object' &&
                l !== null &&
                typeof l.name === 'string' &&
                typeof l.status === 'string' &&
                typeof l.good === 'boolean'
        )
        .slice(0, 40)
        .map((l) => ({ name: l.name.slice(0, 40), status: l.status.slice(0, 40), good: l.good }));
    return { at: raw.at.slice(0, 40), lines, liftsOut: Math.max(0, Math.round(raw.liftsOut)) };
}

// ---- datasets (produced by data/scripts/build_app_data.py) ----------------------------

export type Station = {
    id: string;
    name: string;
    lat: number;
    lon: number;
    zone: number | null;
    // Average weekday taps (entries + exits) in 2019.
    base: number;
    // Weekly weekday taps as % of `base`, aligned with `StationsData.weeks`.
    w: number[];
    lockdown: number | null;
    lockdownStatus: 'ok' | 'closed' | 'unstable_baseline';
    rec2026: number | null;
    recStatus: string;
    dow2026: Array<number | null>;
    elizabeth: boolean;
    frontline: number | null;
    wfh: number | null;
    hospital: string | null;
    // Jobs-only model's predicted lockdown retention (%), or null without census data.
    model: number | null;
};

export type StationsData = {
    weeks: string[];
    network: number[];
    stations: Station[];
};

export type RankedStation = { name: string; pct: number };

export type StoryData = {
    dataEnd: string;
    lockdownWindow: [string, string];
    networkLockdownPct: number;
    stationsClosed: number;
    normalDailyTaps: number;
    stationCount: number;
    keptMoving: RankedStation[];
    emptied: RankedStation[];
    compare: Record<string, { pct: number; lockdownDaily: number }>;
    census: {
        lowFrontline: { frontline: number; wfh: number; retention: number };
        highFrontline: { frontline: number; wfh: number; retention: number };
        rhoFrontline: number;
        rhoWfh: number;
    };
    hospitals: {
        above: number;
        n: number;
        p: number;
        rows: Array<{ station: string; hospital: string; pct: number; neighbours: number }>;
    };
    recoveryByYear: Record<string, number>;
    recoveryByZone: Record<string, { all: number; days: number[] }>;
    zone1UpperBound: { all: number; fri: number };
    elizabethLinePct: number;
    elizabethTop: RankedStation[];
    whatIf: {
        intercept: number;
        slope: number;
        r2: number;
        above: Array<{ name: string; pts: number }>;
        below: Array<{ name: string; pts: number }>;
    };
    // Compact indexes so the lightweight control client never loads stations.json.
    weeks: string[];
    stationIndex: Array<[string, string]>;
};

// Per-station summary served to visitors' phones (`/data/cards.json`).
export type StationCardData = Pick<
    Station,
    | 'id'
    | 'name'
    | 'zone'
    | 'lockdown'
    | 'lockdownStatus'
    | 'rec2026'
    | 'recStatus'
    | 'frontline'
    | 'hospital'
    | 'model'
>;

export type CardsData = {
    networkLockdownPct: number;
    recovery2026: number;
    stations: StationCardData[];
};
