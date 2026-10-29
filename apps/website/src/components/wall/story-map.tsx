import { ScatterplotLayer } from '@deck.gl/layers';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import { Map, useControl } from '@vis.gl/react-maplibre';
import { useEffect, useMemo, useState } from 'react';

import {
    ACCENT_RGB,
    COLORS,
    FONT_FAMILY,
    ZOOM_FIRST_COL,
    MUTED_RGB,
    TILE_PADDING,
    TYPE,
    dotScaleFor,
    isZoomColumn,
    projectToTile,
    type TileView
} from '../../lib/story/layout';
import type { Station } from '../../lib/story/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../lib/wall';

import 'maplibre-gl/dist/maplibre-gl.css';

// No basemap labels: at room scale they are unreadable, and our own labels are larger.
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json';

// Matches the bus clock (one week per 250 ms) so dots glide from week to week.
const WEEK_TRANSITION_MS = 250;
// Switching between reality and the prediction glides slowly so the change can be followed.
const WHAT_IF_TRANSITION_MS = 2000;

// Dot area is proportional to taps (entries + exits): radius = k * sqrt(taps). King's Cross St Pancras
// (~270k taps/day in 2019) gets ~140 px; even in lockdown the busiest stations stay visible
// from across the room.
const RADIUS_PER_SQRT_TAP = 0.27;
const MIN_RADIUS_PX = 10;

const LIGHT_RGB: [number, number, number] = [221, 227, 232];

// A few anchors so viewers can orient themselves. London-map labels sit beside, not on, the
// stations; close-up labels name a station and sit just above its dot.
const AREA_LABELS: Array<{ text: string; lon: number; lat: number }> = [
    { text: 'The City', lon: -0.075, lat: 51.522 },
    { text: 'West End', lon: -0.185, lat: 51.522 },
    { text: 'Canary Wharf', lon: -0.0, lat: 51.49 },
    { text: 'Barking & Dagenham', lon: 0.09, lat: 51.565 },
    { text: 'Heathrow', lon: -0.49, lat: 51.455 },
    { text: 'Brent & Harrow', lon: -0.37, lat: 51.6 }
];
const ZOOM_LABELS: Array<{ text: string; lon: number; lat: number }> = [
    { text: 'Stratford', lon: -0.003, lat: 51.541 },
    { text: 'East Ham', lon: 0.052, lat: 51.539 },
    { text: 'Barking', lon: 0.081, lat: 51.539 },
    { text: 'Ilford', lon: 0.069, lat: 51.559 },
    { text: 'Dagenham', lon: 0.147, lat: 51.541 },
    { text: 'Romford', lon: 0.183, lat: 51.575 },
    { text: 'Beckton', lon: 0.061, lat: 51.514 }
];
const ZOOM_LABEL_OFFSET = -140;

// Colour = how busy a station is *relative to London as a whole* this week. During lockdown
// almost every station is tiny, so absolute colour would hide the story; relative colour shows
// which places kept moving. ratio 0.5 -> grey, 1 -> light, 2+ -> accent blue.
function colourFor(stationPct: number, networkPct: number): [number, number, number, number] {
    const ratio = networkPct > 0 ? stationPct / networkPct : 1;
    const t = Math.min(1, Math.max(0, (Math.log2(Math.max(ratio, 1e-3)) + 1) / 2));
    const [from, to, u] =
        t < 0.5 ? [MUTED_RGB, LIGHT_RGB, t * 2] : [LIGHT_RGB, ACCENT_RGB, t * 2 - 1];
    return [
        Math.round(from[0] + (to[0] - from[0]) * u),
        Math.round(from[1] + (to[1] - from[1]) * u),
        Math.round(from[2] + (to[2] - from[2]) * u),
        235
    ];
}

function radiusFor(station: Station, pct: number) {
    return Math.max(MIN_RADIUS_PX, RADIUS_PER_SQRT_TAP * Math.sqrt((station.base * pct) / 100));
}

// deck.gl drawn *inside* MapLibre's WebGL context (interleaved): one GPU context per screen,
// which matters with 64 screens (see BEST_PRACTICES §7).
function DeckOverlay(props: MapboxOverlayProps) {
    const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
    overlay.setProps(props);
    return null;
}

// Visitor-pick rings breathe slowly (one cycle every 3 s) so a visitor can spot their station.
const PICK_PULSE_MS = 3000;

// What the map shows for a station: a week of real data, or - in the what-if simulator - the
// deepest lockdown as it really was (0) or as predicted from neighbours' jobs (100).
function displayPct(s: Station, week: number, whatIf: number, lockdownWeek: number) {
    if (whatIf === 0) return s.w[week] ?? 0;
    const actual =
        s.lockdownStatus === 'ok' && s.lockdown !== null ? s.lockdown : (s.w[lockdownWeek] ?? 0);
    const model = s.model ?? actual;
    return actual + ((model - actual) * whatIf) / 100;
}

function usePulse(active: boolean) {
    const [phase, setPhase] = useState(0);
    useEffect(() => {
        if (!active) return;
        let frame = 0;
        const step = (now: number) => {
            setPhase((now % PICK_PULSE_MS) / PICK_PULSE_MS);
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [active]);
    return active ? phase : 0;
}

// The basemap and station dots: the continuous background behind every screen. A wall screen
// draws its own 1920 x 1080 window; the whole-wall preview draws everything once at `scale`.
export function StoryMap({
    view,
    width,
    height,
    scale = 1,
    dotScale = 1,
    stations,
    week,
    networkPct,
    selected,
    picks,
    whatIf,
    lockdownWeek,
    lockdownNetworkPct
}: {
    view: TileView;
    width: number;
    height: number;
    scale?: number;
    // Extra size for dots on the close-up map.
    dotScale?: number;
    stations: Station[];
    week: number;
    networkPct: number;
    selected: string | null;
    picks: string[];
    whatIf: number;
    lockdownWeek: number;
    lockdownNetworkPct: number;
}) {
    const selectedStation = stations.find((s) => s.id === selected) ?? null;
    const pickedStations = usePicked(stations, picks);
    const pulse = usePulse(pickedStations.length > 0);
    // Colour stays relative to London as a whole, in whichever world the map is showing.
    const referencePct = whatIf > 0 ? lockdownNetworkPct : networkPct;
    // Slow transitions from the render where the reality/prediction switch flips until they end
    // (state derived during render, so the very layers that start the transition are slow).
    const [lastWhatIf, setLastWhatIf] = useState(whatIf);
    const [switching, setSwitching] = useState(false);
    if (lastWhatIf !== whatIf) {
        setLastWhatIf(whatIf);
        setSwitching(true);
    }
    useEffect(() => {
        if (!switching) return;
        const timer = setTimeout(() => setSwitching(false), WHAT_IF_TRANSITION_MS);
        return () => clearTimeout(timer);
    }, [switching, whatIf]);
    const transitionMs = switching ? WHAT_IF_TRANSITION_MS : WEEK_TRANSITION_MS;

    const layers = useMemo(() => {
        const value = (s: Station) => displayPct(s, week, whatIf, lockdownWeek);
        const radius = (s: Station) => Math.max(1.5, radiusFor(s, value(s)) * dotScale * scale);
        return [
            new ScatterplotLayer<Station>({
                id: 'stations',
                data: stations,
                getPosition: (s) => [s.lon, s.lat],
                getRadius: radius,
                getFillColor: (s) => colourFor(value(s), referencePct),
                radiusUnits: 'pixels',
                stroked: false,
                updateTriggers: {
                    getRadius: [week, whatIf, scale, dotScale],
                    getFillColor: [week, whatIf, referencePct]
                },
                transitions: {
                    getRadius: transitionMs,
                    getFillColor: transitionMs
                }
            }),
            new ScatterplotLayer<Station>({
                id: 'picks',
                data: pickedStations,
                getPosition: (s) => [s.lon, s.lat],
                getRadius: (s) => radius(s) + (30 + 40 * pulse) * scale,
                radiusUnits: 'pixels',
                filled: false,
                stroked: true,
                getLineColor: [...ACCENT_RGB, Math.round(255 * (1 - 0.6 * pulse))],
                lineWidthUnits: 'pixels',
                getLineWidth: Math.max(1, 12 * scale),
                updateTriggers: { getRadius: [week, whatIf, pulse, scale], getLineColor: pulse }
            }),
            new ScatterplotLayer<Station>({
                id: 'selected',
                data: selectedStation ? [selectedStation] : [],
                getPosition: (s) => [s.lon, s.lat],
                getRadius: (s) => radius(s) + 30 * scale,
                radiusUnits: 'pixels',
                filled: false,
                stroked: true,
                getLineColor: [255, 255, 255, 255],
                lineWidthUnits: 'pixels',
                getLineWidth: Math.max(1, 10 * scale),
                updateTriggers: { getRadius: [week, whatIf, scale] }
            })
        ];
    }, [
        stations,
        week,
        whatIf,
        lockdownWeek,
        referencePct,
        selectedStation,
        pickedStations,
        pulse,
        scale,
        dotScale,
        transitionMs
    ]);

    return (
        <div style={{ position: 'absolute', inset: 0, background: COLORS.background }}>
            <Map
                viewState={{
                    ...view,
                    width,
                    height,
                    padding: { top: 0, bottom: 0, left: 0, right: 0 }
                }}
                mapStyle={MAP_STYLE}
                interactive={false}
                attributionControl={false}
                style={{ width, height }}
            >
                <DeckOverlay interleaved layers={layers} />
            </Map>
        </div>
    );
}

function usePicked(stations: Station[], picks: string[]) {
    return useMemo(
        () => picks.map((id) => stations.find((s) => s.id === id)).filter((s): s is Station => !!s),
        [picks, stations]
    );
}

// Where the basemap credit is shown (required by OpenStreetMap / CARTO): under the map legend
// (top-right screen of the London map), where no moving element passes.
const ATTRIBUTION_TILE = { c: ZOOM_FIRST_COL - 1, r: 0 };

// Map text for one screen: area names, picked/selected station names and the credit. Kept out
// of StoryMap so it renders in the text layer, above the scrims.
export function MapLabels({
    c,
    r,
    stations,
    week,
    selected,
    picks,
    whatIf,
    lockdownWeek
}: {
    c: number;
    r: number;
    stations: Station[];
    week: number;
    selected: string | null;
    picks: string[];
    whatIf: number;
    lockdownWeek: number;
}) {
    const selectedStation = stations.find((s) => s.id === selected) ?? null;
    const pickedStations = usePicked(stations, picks);
    const pct = (s: Station) => displayPct(s, week, whatIf, lockdownWeek);
    const zoom = isZoomColumn(c);
    return (
        <>
            {(zoom ? ZOOM_LABELS : AREA_LABELS).map((label) => (
                <TileLabel
                    key={label.text}
                    c={c}
                    r={r}
                    {...label}
                    color={COLORS.subtle}
                    offsetY={zoom ? ZOOM_LABEL_OFFSET : 0}
                />
            ))}
            {[...pickedStations, ...(selectedStation ? [selectedStation] : [])].map((s) => (
                <TileLabel
                    key={s.id}
                    c={c}
                    r={r}
                    text={s.name}
                    lon={s.lon}
                    lat={s.lat}
                    color={s === selectedStation ? COLORS.text : COLORS.accent}
                    offsetY={-(radiusFor(s, pct(s)) * dotScaleFor(c) + 90)}
                />
            ))}
            {c === ATTRIBUTION_TILE.c && r === ATTRIBUTION_TILE.r && (
                <div
                    style={{
                        position: 'absolute',
                        left: TILE_PADDING,
                        bottom: TILE_PADDING / 2,
                        fontFamily: FONT_FAMILY,
                        fontSize: TYPE.secondary,
                        color: COLORS.subtle
                    }}
                >
                    © OpenStreetMap © CARTO
                </div>
            )}
        </>
    );
}

// Approximate rendered width of bold Arial text, used to keep labels inside one screen.
const CHAR_WIDTH_EM = 0.6;

// A label is drawn only by the tile that contains its anchor, and is clamped to that tile's
// safe area, so map labels can never straddle a bezel.
function TileLabel({
    c,
    r,
    text,
    lon,
    lat,
    color,
    offsetY = 0
}: {
    c: number;
    r: number;
    text: string;
    lon: number;
    lat: number;
    color: string;
    offsetY?: number;
}) {
    const [px, py] = projectToTile(c, r, lon, lat);
    if (px < 0 || px >= SCREEN_WIDTH || py < 0 || py >= SCREEN_HEIGHT) return null;
    const width = text.length * TYPE.secondary * CHAR_WIDTH_EM;
    const left = Math.min(
        Math.max(TILE_PADDING / 2, px - width / 2),
        SCREEN_WIDTH - TILE_PADDING / 2 - width
    );
    const top = Math.min(
        Math.max(TILE_PADDING / 2, py + offsetY - TYPE.secondary / 2),
        SCREEN_HEIGHT - TILE_PADDING / 2 - TYPE.secondary
    );
    return (
        <div
            style={{
                position: 'absolute',
                left,
                top,
                fontFamily: FONT_FAMILY,
                fontSize: TYPE.secondary,
                fontWeight: 700,
                lineHeight: 1,
                color,
                whiteSpace: 'nowrap',
                textShadow: `0 0 24px ${COLORS.background}, 0 0 12px ${COLORS.background}`,
                pointerEvents: 'none'
            }}
        >
            {text}
        </div>
    );
}
