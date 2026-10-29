// Physical Data Observatory wall: 16 columns x 4 rows of 1920x1080 displays
// (30,720 x 4,320 px in total). Shared by the `/screen` camera math and the `/` simulator
// so both always agree on the wall geometry.
export const WALL_COLS = 16;
export const WALL_ROWS = 4;
export const SCREEN_WIDTH = 1920;
export const SCREEN_HEIGHT = 1080;

// Browsers cap active WebGL contexts (~16 in Chrome/Safari), and every simulated screen is an
// iframe with its own map canvas. The simulator therefore renders only a sliding window of
// columns live; the rest of the wall is drawn as placeholders.
export const SIMULATOR_LIVE_COLS = 3;
