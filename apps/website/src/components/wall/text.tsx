import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

import { COLORS, FONT_FAMILY, TILE_PADDING, TYPE } from '../../lib/story/layout';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../lib/wall';

type Size = keyof typeof TYPE;

const LINE_HEIGHT: Record<Size, number> = {
    title: 1.05,
    big: 1.05,
    primary: 1.1,
    secondary: 1.25
};

// Text may not come closer than this to a screen edge (half the tile padding).
const BEZEL_MARGIN = TILE_PADDING / 2;

// Dev-only guard: outline in red any line whose glyphs reach into a screen's edge margin, so an
// overflowing line is obvious in the simulator or a screenshot. Measures the rendered text
// itself (a Range), not its box, so it also catches text inside shrink-wrapped flex rows.
export function useBezelCheck(ref: React.RefObject<HTMLDivElement | null>) {
    useLayoutEffect(() => {
        if (!import.meta.env.DEV || !ref.current) return;
        // Measure in the coordinates of the screen this text belongs to, which may be drawn
        // scaled down (whole-wall preview).
        const screen = ref.current.closest('[data-wall-screen]')?.getBoundingClientRect();
        const k = screen ? screen.width / SCREEN_WIDTH : 1;
        for (const child of Array.from(ref.current.children) as HTMLElement[]) {
            const range = document.createRange();
            range.selectNodeContents(child);
            const box = range.getBoundingClientRect();
            const left = (box.left - (screen?.left ?? 0)) / k;
            const top = (box.top - (screen?.top ?? 0)) / k;
            const right = left + box.width / k;
            const bottom = top + box.height / k;
            const overflow =
                box.width > 0 &&
                (left < BEZEL_MARGIN ||
                    right > SCREEN_WIDTH - BEZEL_MARGIN ||
                    top < BEZEL_MARGIN / 2 ||
                    bottom > SCREEN_HEIGHT - BEZEL_MARGIN / 2);
            child.style.outline = overflow ? '12px solid red' : '';
        }
    });
}

// One block of wall text. Lines are explicit (no automatic wrapping) so every line is checked
// by eye to fit inside a single 1920 px screen - text must never cross a bezel.
export function Lines({
    lines,
    size,
    color = COLORS.text,
    weight = 700,
    style
}: {
    lines: ReactNode[];
    size: Size;
    color?: string;
    weight?: number;
    style?: CSSProperties;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useBezelCheck(ref);
    return (
        <div
            ref={ref}
            style={{
                fontSize: TYPE[size],
                lineHeight: LINE_HEIGHT[size],
                fontWeight: weight,
                color,
                letterSpacing: size === 'title' || size === 'big' ? '-0.02em' : undefined,
                whiteSpace: 'nowrap',
                ...style
            }}
        >
            {lines.map((line, i) => (
                <div key={i}>{line}</div>
            ))}
        </div>
    );
}

// Small uppercase label that introduces a tile, in the accent colour.
export function Kicker({ children }: { children: ReactNode }) {
    return (
        <Lines
            lines={[children]}
            size="secondary"
            color={COLORS.accent}
            style={{ letterSpacing: '0.03em', textTransform: 'uppercase' }}
        />
    );
}

// Full-tile content box: padded safe area, vertical stack, optional background.
export function Tile({
    children,
    // Transparent by default: the map and backdrop show through, continuous across screens.
    background = 'transparent',
    justify = 'center',
    gap = 40
}: {
    children?: ReactNode;
    background?: string;
    justify?: 'center' | 'flex-start' | 'flex-end' | 'space-between';
    gap?: number;
}) {
    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                padding: TILE_PADDING,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: justify,
                gap,
                background,
                fontFamily: FONT_FAMILY,
                color: COLORS.text,
                // Lifts text off the map behind it without drawing a box.
                textShadow: '0 4px 28px rgba(0, 0, 0, 0.55)',
                overflow: 'hidden'
            }}
        >
            {children}
        </div>
    );
}
