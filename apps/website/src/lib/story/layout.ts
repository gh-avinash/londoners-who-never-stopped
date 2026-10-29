import { WebMercatorViewport } from '@deck.gl/core';

import { SCREEN_HEIGHT, SCREEN_WIDTH, WALL_COLS, WALL_ROWS } from '../wall';
import { effectiveFocus } from './timeline';
import type { StoryState } from './types';

// ---- brand -----------------------------------------------------------------------------
// Imperial brand palette only (Core guidelines, p.111-113). On screens the brand recommends
// #161A1D rather than true black. Deep Sky Blue / Slate Gray come from the expanded palette.
export const COLORS = {
    background: '#161A1D',
    text: '#FFFFFF',
    imperialBlue: '#0000CD',
    accent: '#00BFFF',
    muted: '#708090',
    // Slate Gray is too dark for small-ish text on #161A1D; this lighter mix keeps ~7:1 contrast.
    subtle: '#B4BCC4'
} as const;

export const ACCENT_RGB: [number, number, number] = [0, 191, 255];
export const MUTED_RGB: [number, number, number] = [112, 128, 144];

// Imperial Sans is licensed via the brand media library; the guidelines name Arial as the
// approved fallback.
export const FONT_FAMILY = "'Imperial Sans Text', 'Imperial Sans', Arial, sans-serif";

// ---- type scale (wall pixels) ------------------------------------------------------------
// BEST_PRACTICES: primary wall text >= 20% of screen height (216 px) for ~10 m viewing.
// Toolkit: never below 3% of canvas height (130 px). Secondary text sits at that floor.
// Big numbers match the title (300 px) so a tile fits a number plus three lines of text.
export const TYPE = {
    title: 300,
    big: 300,
    primary: 216,
    secondary: 130
} as const;

// Safe area inside every tile so text never touches a bezel.
export const TILE_PADDING = 120;

// ---- sections (columns) ---------------------------------------------------------------
// Left-to-right narrative as recommended by the DO Content Planner. Rows 1-3 hold the sections;
// row 4 is the timeline river that runs the full width of the room (see wall-graphics.tsx).
// The two maps take 7 of the 16 columns, so the text is compressed into the other 9.
export type Section =
    | 'title'
    | 'normal'
    | 'map'
    | 'lockdown'
    | 'recovery'
    | 'whatif'
    | 'live'
    | 'future';

// 'normal' (the 2019 baseline figure) shares column 1 with the title; sectionOfColumn() returns
// the first match, so that column is treated as part of the always-lit title.
export const SECTION_COLUMNS: Record<Section, [number, number]> = {
    title: [0, 1],
    normal: [1, 1],
    map: [2, 8],
    lockdown: [9, 11],
    recovery: [12, 12],
    whatif: [13, 13],
    live: [14, 14],
    future: [15, 15]
};

export function sectionOfColumn(c: number): Section {
    const found = (Object.entries(SECTION_COLUMNS) as Array<[Section, [number, number]]>).find(
        ([, [from, to]]) => c >= from && c <= to
    );
    return found ? found[0] : 'future';
}

// The title, maps and live panel are never dimmed: the maps are the shared stage for every
// section and live data is always current.
export function isSpotlit(section: Section, state: Pick<StoryState, 'focus' | 'week'>) {
    if (state.focus === 'all' || section === 'title' || section === 'map' || section === 'live') {
        return true;
    }
    return section === effectiveFocus(state);
}

// ---- timeline river (bottom row) --------------------------------------------------------
export const RIVER_ROW = WALL_ROWS - 1;
export const RIVER_TOP = RIVER_ROW * SCREEN_HEIGHT;
// Inside the river row: a label band on top, the curve, then year labels.
export const RIVER_LABEL_BAND = 330;
export const RIVER_CURVE_TOP = RIVER_TOP + RIVER_LABEL_BAND;
export const RIVER_CURVE_BOTTOM = RIVER_TOP + SCREEN_HEIGHT - 170;
export const RIVER_Y_MAX = 110;

// ---- maps: the continuous background of the whole wall ------------------------------------
// The basemap runs behind all 64 screens. Two cameras share it:
//   - all of London, uncropped, on columns 2-5 (true shape at full wall height; London is
//     ~1.75:1, so ~4 columns is the widest it can be without cropping or stretching);
//   - a close-up of East London - where London kept moving - on columns 6-8, ~2.5x closer.
// Every screen uses the camera of its column: columns 0-5 continue the London map, 6-15 the
// close-up. Thin connector lines (wall-graphics.tsx) tie the close-up to its box on the map.
export const MAP_FIRST_COL = 2;
export const MAP_COLS = 4;
export const ZOOM_FIRST_COL = MAP_FIRST_COL + MAP_COLS;
export const ZOOM_COLS = 3;
const WALL_WIDTH = WALL_COLS * SCREEN_WIDTH;
const WALL_HEIGHT = WALL_ROWS * SCREEN_HEIGHT;

// Extent of the stations in the data (Amersham/Chesham to Shenfield, West Croydon to Epping).
const LONDON_BOUNDS: [[number, number], [number, number]] = [
    [-0.62, 51.37],
    [0.34, 51.71]
];
// Stratford to Upminster, Wanstead to the Royal Docks: Barking & Dagenham's cluster of
// "kept moving" stations and its neighbours.
export const ZOOM_BOUNDS: [[number, number], [number, number]] = [
    [-0.02, 51.5],
    [0.26, 51.6]
];

type Camera = { viewport: WebMercatorViewport; x0: number; x1: number };

// London fitted to the full wall height inside a box wider than itself, centred on its columns.
const LONDON_CAMERA: Camera = {
    viewport: new WebMercatorViewport({
        width: (MAP_COLS + 2) * SCREEN_WIDTH,
        height: WALL_HEIGHT
    }).fitBounds(LONDON_BOUNDS, { padding: { top: 40, bottom: 40, left: 0, right: 0 } }),
    x0: (MAP_FIRST_COL - 1) * SCREEN_WIDTH,
    x1: ZOOM_FIRST_COL * SCREEN_WIDTH
};

// The close-up leaves a band at the top for its heading and sits above the timeline's curve.
const ZOOM_CAMERA: Camera = {
    viewport: new WebMercatorViewport({
        width: ZOOM_COLS * SCREEN_WIDTH,
        height: WALL_HEIGHT
    }).fitBounds(ZOOM_BOUNDS, { padding: { top: 600, bottom: 500, left: 60, right: 60 } }),
    x0: ZOOM_FIRST_COL * SCREEN_WIDTH,
    x1: WALL_WIDTH
};

export function isZoomColumn(c: number) {
    return c >= ZOOM_FIRST_COL;
}

function cameraFor(c: number) {
    return isZoomColumn(c) ? ZOOM_CAMERA : LONDON_CAMERA;
}

// Station dots are drawn larger in the close-up, in proportion with its streets.
export const ZOOM_DOT_SCALE = 1.6;
export function dotScaleFor(c: number) {
    return isZoomColumn(c) ? ZOOM_DOT_SCALE : 1;
}

export type TileView = {
    longitude: number;
    latitude: number;
    zoom: number;
    bearing: number;
    pitch: number;
};

// Camera centred on a wall pixel. Screens sharing a camera share its zoom, so the basemap joins
// seamlessly across their bezels.
function viewAt(camera: Camera, x: number, y: number, zoomOffset = 0): TileView {
    const [longitude, latitude] = camera.viewport.unproject([x - camera.x0, y]);
    return {
        longitude,
        latitude,
        zoom: camera.viewport.zoom + zoomOffset,
        bearing: 0,
        pitch: 0
    };
}

// Camera for one screen.
export function tileMapView(c: number, r: number): TileView {
    return viewAt(cameraFor(c), (c + 0.5) * SCREEN_WIDTH, (r + 0.5) * SCREEN_HEIGHT);
}

// The two map regions for the one-page whole-wall preview, drawn at `scale` of real size:
// columns 0-5 (London) and 6-15 (close-up).
export function previewMapRegions(scale: number) {
    return [
        { camera: LONDON_CAMERA, from: 0, to: ZOOM_FIRST_COL, dotScale: 1 },
        { camera: ZOOM_CAMERA, from: ZOOM_FIRST_COL, to: WALL_COLS, dotScale: ZOOM_DOT_SCALE }
    ].map(({ camera, from, to, dotScale }) => {
        const x0 = from * SCREEN_WIDTH;
        const width = (to - from) * SCREEN_WIDTH;
        return {
            left: x0 * scale,
            width: width * scale,
            height: WALL_HEIGHT * scale,
            dotScale,
            view: viewAt(camera, x0 + width / 2, WALL_HEIGHT / 2, Math.log2(scale))
        };
    });
}

// Wall pixel of a lon/lat on the London map or the close-up.
export function projectToWall(lon: number, lat: number, zoom = false): [number, number] {
    const camera = zoom ? ZOOM_CAMERA : LONDON_CAMERA;
    const [x, y] = camera.viewport.project([lon, lat]);
    return [x + camera.x0, y];
}

// Pixel position of a lon/lat inside a given screen (may fall outside 0..1920 / 0..1080).
export function projectToTile(c: number, r: number, lon: number, lat: number): [number, number] {
    const [x, y] = projectToWall(lon, lat, isZoomColumn(c));
    return [x - c * SCREEN_WIDTH, y - r * SCREEN_HEIGHT];
}

// ---- formatting --------------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Deterministic (no locale/timezone dependence), so server and client render identical text.
export function formatWeek(iso: string | undefined) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatPct(value: number | null | undefined, digits = 0) {
    if (value === null || value === undefined) return '–';
    return `${value.toFixed(digits)}%`;
}

export function findWeek(weeks: string[], iso: string) {
    const index = weeks.findIndex((w) => w >= iso);
    return index === -1 ? weeks.length - 1 : index;
}
