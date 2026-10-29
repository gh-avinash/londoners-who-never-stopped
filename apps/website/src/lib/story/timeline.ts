// "Story time": how a week of data maps to a horizontal position on the 16-column wall.
//
// The timeline river runs the full width of the room, but time is not spread evenly. Each era is
// stretched over the section of the wall that tells its story, so the playhead physically walks
// the visitor through the narrative:
//   Jan 2019 - Mar 2020  -> columns 1-2   (title, "before")
//   Mar 2020 - Jan 2021  -> columns 3-12  (maps, lockdown)  - stretched: the drama
//   Jan 2021 - Oct 2026  -> columns 13-16 (recovery, what-if, live, what it means)
//
// Pure functions with no data or DOM dependency, so the bus server (which owns the playback
// clock) and every screen compute identical positions.

import { SCREEN_WIDTH, WALL_COLS } from '../wall';
import type { Focus, StoryState } from './types';

// The data's first week (Monday) - see data/scripts/build_app_data.py FIRST_WEEK.
const FIRST_WEEK_UTC = Date.UTC(2019, 0, 7);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function weekIndexOf(isoDate: string): number {
    const [y, m, d] = isoDate.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - FIRST_WEEK_UTC) / WEEK_MS);
}

export const ERA_LOCKDOWN_START = weekIndexOf('2020-03-02');
export const ERA_RECOVERY_START = weekIndexOf('2021-01-04');

// Wall x (px) where each era starts; the last era ends at the right edge of the wall.
const ERA_X = [0, 2 * SCREEN_WIDTH, 12 * SCREEN_WIDTH, WALL_COLS * SCREEN_WIDTH];

// Key moments the playhead pauses on during playback, and the section spotlit in each era.
export const DEEPEST_LOCKDOWN_WEEK = weekIndexOf('2020-04-20');

// Wall x position of a (possibly fractional) week index, given the last week index.
export function weekToX(week: number, lastWeek: number): number {
    const w = Math.max(0, Math.min(week, lastWeek));
    const bounds = [
        0,
        ERA_LOCKDOWN_START,
        ERA_RECOVERY_START,
        Math.max(lastWeek, ERA_RECOVERY_START + 1)
    ];
    for (let i = 0; i < 3; i++) {
        if (w <= bounds[i + 1] || i === 2) {
            const t = (w - bounds[i]) / (bounds[i + 1] - bounds[i]);
            return ERA_X[i] + t * (ERA_X[i + 1] - ERA_X[i]);
        }
    }
    return ERA_X[3];
}

// Playback moves the playhead at a constant speed across the room (not a constant number of
// weeks per second), so the stretched lockdown era plays slowly and the long recovery quickly.
// ~480 px/s -> the full 30,720 px wall in about a minute.
export const PLAYHEAD_PX_PER_SECOND = 480;

export function weekDurationMs(week: number, lastWeek: number): number {
    const dx = weekToX(week + 1, lastWeek) - weekToX(week, lastWeek);
    return Math.max(40, (dx / PLAYHEAD_PX_PER_SECOND) * 1000);
}

// Pauses (ms) on key weeks so visitors can take them in.
export function holdMs(week: number, lastWeek: number): number {
    if (week === DEEPEST_LOCKDOWN_WEEK) return 6000;
    if (week === lastWeek) return 10000;
    return 0;
}

// Section the spotlight follows when focus is 'auto'.
export function autoFocus(week: number): Exclude<Focus, 'auto'> {
    if (week < ERA_LOCKDOWN_START) return 'normal';
    if (week < ERA_RECOVERY_START) return 'lockdown';
    return 'recovery';
}

// The section actually spotlit for a given state.
export function effectiveFocus(state: Pick<StoryState, 'focus' | 'week'>): Exclude<Focus, 'auto'> {
    return state.focus === 'auto' ? autoFocus(state.week) : state.focus;
}
