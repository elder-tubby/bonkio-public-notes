function getSpawnDiameter(mapSize) {
    let diameter = 18;
    const sizeMap = {
        13: 10,
        12: 12,
        11: 14,
        10: 16,
        9: 18,
        8: 20,
        7: 24,
        6: 26,
        5: 30,
        4: 34,
        3: 40,
        2: 48,
        1: 60,
    };
    return sizeMap[mapSize] || diameter;
}

function hslToRgbStr(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `rgb(${Math.round(255 * f(0))}, ${Math.round(255 * f(8))}, ${Math.round(255 * f(4))})`;
}

// ==========================================
// GLOBAL THEME GENERATOR
// ==========================================
// Shifts `baseL` by an offset in [minOffset, maxOffset], picking lighter or darker
// at random. If the preferred direction would clamp against floor/ceiling and lose
// most of its offset, it flips direction instead of shrinking - this is what keeps
// shifted colors from ending up nearly identical to the anchor when the anchor is
// already very light or very dark.
function pickShiftedLightness(
    baseL,
    minOffset,
    maxOffset,
    floor = 6,
    ceiling = 94,
) {
    const offset =
        Math.floor(Math.random() * (maxOffset - minOffset + 1)) + minOffset;
    const preferLighter = Math.random() > 0.5;

    const lighterVal = baseL + offset;
    const darkerVal = baseL - offset;
    const lighterFits = lighterVal <= ceiling;
    const darkerFits = darkerVal >= floor;

    if (preferLighter && lighterFits) return lighterVal;
    if (!preferLighter && darkerFits) return darkerVal;
    // Preferred direction clamps too hard - flip if the other direction has room.
    if (lighterFits) return lighterVal;
    if (darkerFits) return darkerVal;
    // Neither direction has room for the full offset (anchor is near a boundary
    // and offset is large) - clamp to whichever extreme, at least maximizing gap.
    return preferLighter ? ceiling : floor;
}

function generateBeautifulColorScheme() {
    // 1. NORMAL: The Anchor (Infinite Variety - Pinks, Purples, Greens, Browns, etc.)
    const normH = Math.floor(Math.random() * 360);
    const normS = Math.floor(Math.random() * 101); // 0 to 100% saturation
    const normL = Math.floor(Math.random() * 50) + 25; // 25 to 75% lightness (leaves room for shades)
    const normStr = hslToRgbStr(normH, normS, normL);
    const normRgb = extractRgb(normStr);

    // 2 & 3. BACKGROUND and DEATH: locked to Normal's exact Hue/Saturation, only
    // Lightness shifts. We retry a handful of times, verifying actual RGB distance
    // between every pair (norm/bg, norm/death, bg/death), so none of the three ever
    // end up looking too close to each other regardless of where Normal's lightness
    // happens to land.
    const MIN_RGB_DISTANCE = 55;
    let bgL, deathL, bgStr, deathStr;

    for (let attempt = 0; attempt < 25; attempt++) {
        bgL = pickShiftedLightness(normL, 18, 32, 8, 92);
        deathL = pickShiftedLightness(normL, 26, 40, 6, 94);

        bgStr = hslToRgbStr(normH, normS, bgL);
        deathStr = hslToRgbStr(normH, normS, deathL);

        const bgRgb = extractRgb(bgStr);
        const deathRgb = extractRgb(deathStr);

        const normBgDist = getColorDistance(normRgb, bgRgb);
        const normDeathDist = getColorDistance(normRgb, deathRgb);
        const bgDeathDist = getColorDistance(bgRgb, deathRgb);

        if (
            normBgDist > MIN_RGB_DISTANCE &&
            normDeathDist > MIN_RGB_DISTANCE &&
            bgDeathDist > MIN_RGB_DISTANCE
        ) {
            break; // Good separation across all three - keep these values.
        }
        // Otherwise loop again with fresh random offsets/directions.
    }

    const bgH = normH,
        bgS = normS;
    const deathH = normH,
        deathS = normS;

    // 4. BOUNCY: Striking contrast on the color wheel (120° to 240° away)
    const bounceH = (normH + 120 + Math.floor(Math.random() * 120)) % 360;
    const bounceS = Math.floor(Math.random() * 45) + 50; // 50% to 95%
    const bounceL = Math.floor(Math.random() * 40) + 30; // 30% to 70%

    // 5. Intelligent Shading Patterns - pick one of the 8 shared shading directions
    const chosenShade = getRandomShadingStyle();

    return {
        shadingStyle: chosenShade,
        background: hslToRgbStr(bgH, bgS, bgL),
        none: hslToRgbStr(normH, normS, normL),
        death: hslToRgbStr(deathH, deathS, deathL),
        bouncy: hslToRgbStr(bounceH, bounceS, bounceL),
    };
}

// ==========================================
// SPECIFIC COLOR CHANGER (INDEPENDENT)
// ==========================================
function extractRgb(rgbStr) {
    if (typeof rgbStr !== "string") return [0, 0, 0]; // Safely ignore non-strings
    const match = rgbStr.match(/\d+/g);
    return match ? match.map(Number) : [0, 0, 0];
}

function getColorDistance(rgb1, rgb2) {
    return Math.hypot(rgb1[0] - rgb2[0], rgb1[1] - rgb2[1], rgb1[2] - rgb2[2]);
}

function generateDistinctColor(currentColors, typeToChange, hslToRgbStrFn) {
    // FIX: Only iterate over actual color keys, ignoring the new shading configuration objects/booleans
    const validColorKeys = ["background", "none", "bouncy", "death"];

    const otherColors = validColorKeys
        .filter((k) => k !== typeToChange)
        .map((k) => extractRgb(currentColors[k]));

    for (let attempt = 0; attempt < 500; attempt++) {
        // Absolute independent freedom - thousands of variations, any hue, saturation, or lightness
        let h = Math.floor(Math.random() * 360);
        let s = Math.floor(Math.random() * 101);
        let l = Math.floor(Math.random() * 84) + 8;

        const candidateStr = hslToRgbStrFn(h, s, l);
        const candidateRgb = extractRgb(candidateStr);

        let minDistance = Infinity;
        for (const otherRgb of otherColors) {
            const dist = getColorDistance(candidateRgb, otherRgb);
            if (dist < minDistance) minDistance = dist;
        }

        // Threshold of 70 is enough to guarantee the new color reads as visibly
        // distinct from every other active color, while still leaving thousands
        // of hue/saturation/lightness combinations available.
        if (minDistance > 70 || attempt === 499) {
            return candidateStr;
        }
    }
}

// ==========================================
// SHADING STYLE HELPERS
// ==========================================
const SHADING_STYLES = [
    "left-to-right",
    "right-to-left",
    "top-to-bottom",
    "bottom-to-top",
    "diagonal-nw-se",
    "diagonal-ne-sw",
    "radial-out",
    "radial-in",
];

function getRandomShadingStyle() {
    return SHADING_STYLES[Math.floor(Math.random() * SHADING_STYLES.length)];
}

// ==========================================
// SPATIAL SHADING DISTRIBUTION ENGINE
// ==========================================
function getSpatialShade(rgbStr, obj, style = "left-to-right") {
    if (!rgbStr || typeof rgbStr !== "string") return rgbStr;
    const match = rgbStr.match(/\d+/g);
    if (!match || match.length < 3) return rgbStr;

    let x = 500,
        y = 300;
    if (obj.c) {
        x = obj.c.x;
        y = obj.c.y;
    } else if (obj.start && obj.end) {
        x = (obj.start.x + obj.end.x) / 2;
        y = (obj.start.y + obj.end.y) / 2;
    }

    // Standard map bounds for normalization
    const nx = Math.max(0, Math.min(1, x / 750));
    const ny = Math.max(0, Math.min(1, y / 500));

    let factor = 0;
    switch (style) {
        case "left-to-right":
            factor = nx * 2 - 1;
            break;
        case "right-to-left":
            factor = 1 - nx * 2;
            break;
        case "top-to-bottom":
            factor = ny * 2 - 1;
            break;
        case "bottom-to-top":
            factor = 1 - ny * 2;
            break;
        case "diagonal-nw-se":
            factor = ((nx + ny) / 2) * 2 - 1;
            break;
        case "diagonal-ne-sw":
            factor = ((1 - nx + ny) / 2) * 2 - 1;
            break;
        case "radial-out":
            factor = Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2) * 2 - 1;
            break;
        case "radial-in":
            factor = 1 - Math.min(1, Math.hypot(nx - 0.5, ny - 0.5) * 2) * 2;
            break;
        default:
            factor = 0;
    }

    // MULTIPLIER CRANKED UP. Ranges from 0.35x brightness to 1.65x brightness.
    // This creates an impossible-to-miss, heavy, elegant gradient across the map.
    const multiplier = 1 + factor * 0.3;
    const [r, g, b] = match.map(Number);
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

    return `rgb(${clamp(r * multiplier)}, ${clamp(g * multiplier)}, ${clamp(b * multiplier)})`;
}

module.exports = {
    hslToRgbStr,
    getSpawnDiameter,
    generateBeautifulColorScheme,
    generateDistinctColor,
    getSpatialShade,
    getRandomShadingStyle,
};
