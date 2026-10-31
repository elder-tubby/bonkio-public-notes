// tunnel-generator.js
import State from "./state.js";
import * as Network from "./network.js";
import UI from "./ui.js";
import { showToast, createValidPolygonObject } from "./utils-client.js";

// ==========================================
// 1. DATA PARSING & GEOMETRY HELPERS
// ==========================================
function extractPoints(data) {
    if (Array.isArray(data)) {
        if (data.length > 0) {
            if (data[0].x !== undefined && data[0].y !== undefined) return data;
            if (Array.isArray(data[0]) && data[0].length >= 2)
                return data.map((p) => ({ x: Number(p[0]), y: Number(p[1]) }));
        }
    } else if (data && typeof data === "object") {
        if (data.trajectory) return extractPoints(data.trajectory);
        if (data.tracePoints) return extractPoints(data.tracePoints);
        if (data.path) return extractPoints(data.path);
        for (const key of Object.keys(data)) {
            if (Array.isArray(data[key])) {
                const pts = extractPoints(data[key]);
                if (pts.length > 0) return pts;
            }
        }
    }
    return [];
}

function convertPkrToGame(pkrX, pkrY, GW, GH) {
    const normX = (pkrX + 365) / 730;
    const normY = (pkrY + 250) / 500;
    return { x: normX * GW, y: normY * GH };
}

function rotatePoint(pt, angleDeg) {
    const r = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(r),
        sin = Math.sin(r);
    return { x: pt.x * cos - pt.y * sin, y: pt.x * sin + pt.y * cos };
}

function ptRound(x, y) {
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

function walkPath(points, spacing) {
    let resampled = [];
    if (points.length === 0) return resampled;
    resampled.push({ x: points[0].x, y: points[0].y });
    let d = 0;
    for (let i = 1; i < points.length; i++) {
        let p0 = points[i - 1],
            p1 = points[i];
        let dx = p1.x - p0.x,
            dy = p1.y - p0.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.001) continue;
        let dirX = dx / dist,
            dirY = dy / dist,
            distLeft = dist;
        while (d + distLeft >= spacing) {
            let take = spacing - d;
            resampled.push({
                x: p1.x - dirX * (distLeft - take),
                y: p1.y - dirY * (distLeft - take),
            });
            distLeft -= take;
            d = 0;
        }
        d += distLeft;
    }
    let lastP = resampled[resampled.length - 1],
        endP = points[points.length - 1];
    if (Math.hypot(lastP.x - endP.x, lastP.y - endP.y) > spacing * 0.2)
        resampled.push({ x: endP.x, y: endP.y });
    return resampled;
}

function smoothPath(points, iterations) {
    if (points.length < 3) return points;
    let current = points;
    for (let it = 0; it < iterations; it++) {
        const next = [current[0]];
        for (let i = 0; i < current.length - 1; i++) {
            const p0 = current[i],
                p1 = current[i + 1];
            next.push({
                x: 0.75 * p0.x + 0.25 * p1.x,
                y: 0.75 * p0.y + 0.25 * p1.y,
            });
            next.push({
                x: 0.25 * p0.x + 0.75 * p1.x,
                y: 0.25 * p0.y + 0.75 * p1.y,
            });
        }
        next.push(current[current.length - 1]);
        current = next;
    }
    return current;
}

function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x,
        dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
    );
    const closest = { x: a.x + t * dx, y: a.y + t * dy };
    return Math.hypot(p.x - closest.x, p.y - closest.y);
}

function rdpSimplify(points, epsilon) {
    const n = points.length;
    if (n < 3) return points;
    let maxDist = 0,
        index = 0;
    const a = points[0],
        b = points[n - 1];
    for (let i = 1; i < n - 1; i++) {
        const d = perpendicularDistance(points[i], a, b);
        if (d > maxDist) {
            maxDist = d;
            index = i;
        }
    }
    if (maxDist > epsilon) {
        const part1 = rdpSimplify(points.slice(0, index + 1), epsilon);
        const part2 = rdpSimplify(points.slice(index), epsilon);
        return part1.slice(0, -1).concat(part2);
    } else {
        return [a, b];
    }
}

function getPolyArea(verts) {
    let area = 0;
    for (let i = 0; i < verts.length; i++)
        area +=
            verts[i].x * verts[(i + 1) % verts.length].y -
            verts[(i + 1) % verts.length].x * verts[i].y;
    return Math.abs(area / 2);
}

function getConvexHull(points) {
    if (points.length <= 3) return points;
    let pts = [...points].sort((a, b) =>
        Math.abs(a.x - b.x) < 0.001 ? a.y - b.y : a.x - b.x,
    );
    const cross = (o, a, b) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let p of pts) {
        while (
            lower.length >= 2 &&
            cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
        )
            lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        let p = pts[i];
        while (
            upper.length >= 2 &&
            cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
        )
            upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

function smartCondense(polygons, tolerance) {
    let polys = [...polygons];
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < polys.length; i++) {
            for (let j = i + 1; j < polys.length; j++) {
                let pA = polys[i],
                    pB = polys[j];

                let minXA = pA[0].x,
                    maxXA = pA[0].x,
                    minYA = pA[0].y,
                    maxYA = pA[0].y;
                for (let p of pA) {
                    minXA = Math.min(minXA, p.x);
                    maxXA = Math.max(maxXA, p.x);
                    minYA = Math.min(minYA, p.y);
                    maxYA = Math.max(maxYA, p.y);
                }
                let minXB = pB[0].x,
                    maxXB = pB[0].x,
                    minYB = pB[0].y,
                    maxYB = pB[0].y;
                for (let p of pB) {
                    minXB = Math.min(minXB, p.x);
                    maxXB = Math.max(maxXB, p.x);
                    minYB = Math.min(minYB, p.y);
                    maxYB = Math.max(maxYB, p.y);
                }

                if (
                    maxXA < minXB - 2 ||
                    minXA > maxXB + 2 ||
                    maxYA < minYB - 2 ||
                    minYA > maxYB + 2
                )
                    continue;

                let hull = getConvexHull([...pA, ...pB]);
                let areaA = getPolyArea(pA),
                    areaB = getPolyArea(pB),
                    areaHull = getPolyArea(hull);

                if (areaHull <= (areaA + areaB) * tolerance) {
                    polys[i] = hull;
                    polys.splice(j, 1);
                    changed = true;
                    break;
                }
            }
            if (changed) break;
        }
    }
    return polys;
}

function forceCCW(poly) {
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
        let p1 = poly[i];
        let p2 = poly[(i + 1) % poly.length];
        sum += (p2[0] - p1[0]) * (p2[1] + p1[1]);
    }
    if (sum > 0) return poly.reverse();
    return poly;
}

// --- NEW INTELLIGENT VERTEX SNAPPING LOGIC ---
// Snaps drifted vertices seamlessly back onto the Map Segments
function snapPolygonsToMap(polygons, mapClipGeoms, threshold = 8.0) {
    const mapSegments = [];
    mapClipGeoms.forEach((geom) => {
        const ring = geom[0];
        for (let i = 0; i < ring.length - 1; i++) {
            mapSegments.push({
                a: { x: ring[i][0], y: ring[i][1] },
                b: { x: ring[i + 1][0], y: ring[i + 1][1] },
            });
        }
    });

    return polygons.map((poly) => {
        return poly.map((pt) => {
            let closestDist = threshold;
            let snapPt = { x: pt.x, y: pt.y };

            for (const seg of mapSegments) {
                const { a, b } = seg;
                const dx = b.x - a.x,
                    dy = b.y - a.y;
                const lenSq = dx * dx + dy * dy;
                let t = 0;
                if (lenSq > 0)
                    t = Math.max(
                        0,
                        Math.min(
                            1,
                            ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq,
                        ),
                    );

                const projX = a.x + t * dx;
                const projY = a.y + t * dy;
                const dist = Math.hypot(pt.x - projX, pt.y - projY);

                if (dist < closestDist) {
                    closestDist = dist;
                    snapPt = { x: projX, y: projY };

                    // Favor exact corner snapping to perfectly seal junctions
                    if (Math.hypot(pt.x - a.x, pt.y - a.y) < threshold)
                        snapPt = { x: a.x, y: a.y };
                    if (Math.hypot(pt.x - b.x, pt.y - b.y) < threshold)
                        snapPt = { x: b.x, y: b.y };
                }
            }
            return snapPt;
        });
    });
}

// ==========================================
// 2. MAIN TUNNEL GENERATOR ENGINE
// ==========================================
export async function generateDeathTunnel(paddingVal) {
    try {
        showToast("Reading clipboard data...", false);
        let text = await navigator.clipboard.readText();
        if (!text || text.trim() === "") {
            showToast("Clipboard is empty.", true);
            return;
        }

        let pathData;
        try {
            pathData = JSON.parse(text);
        } catch (e) {
            showToast("Clipboard data is not valid JSON.", true);
            return;
        }

        const rawPoints = extractPoints(pathData);
        if (rawPoints.length < 2) {
            showToast("Found less than 2 valid points.", true);
            return;
        }

        showToast("Carving optimized polygons...", false);

        const canvas = UI.elems.canvas;
        const GW = canvas ? canvas.width : 730;
        const GH = canvas ? canvas.height : 500;

        let gamePoints = rawPoints.map((p) =>
            convertPkrToGame(p.x, p.y, GW, GH),
        );

        // 1. Walk & Smooth Path (Aggressively flattened for efficiency)
        let spaced = walkPath(gamePoints, 18);
        let ultraSmoothed = smoothPath(spaced, 2);
        // Pre-simplify the path so we stamp fewer primitives overall
        const trace = rdpSimplify(walkPath(ultraSmoothed, 12), 2.5);

        if (trace.length < 2) {
            showToast("Path is too short.", true);
            return;
        }

        // 2. Parse Existing Map Objects
        const mapClipGeoms = [];
        const objects = State.get("objects") || [];

        objects.forEach((obj) => {
            if (
                obj.isBgLine ||
                obj.isZone ||
                obj.noPhysics ||
                obj.isZoneIndicator ||
                obj.isCapzone
            )
                return;

            let verts = [];
            if (obj.type === "poly") {
                const a = obj.a || 0,
                    s = obj.scale || 1,
                    c = obj.c;
                verts = (obj.v || []).map((lv) => {
                    const rot = rotatePoint({ x: lv.x * s, y: lv.y * s }, a);
                    return { x: c.x + rot.x, y: c.y + rot.y };
                });
            } else if (obj.type === "line") {
                const start = obj.start;
                const angle = obj.angle || 0;
                const width = obj.width || 0;
                const h = (obj.height || 4) / 2;
                const end = obj.end || {
                    x: start.x + Math.cos((angle * Math.PI) / 180) * width,
                    y: start.y + Math.sin((angle * Math.PI) / 180) * width,
                };

                const dx = end.x - start.x,
                    dy = end.y - start.y;
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                    const nx = (-dy / len) * h,
                        ny = (dx / len) * h;
                    verts = [
                        { x: start.x + nx, y: start.y + ny },
                        { x: start.x - nx, y: start.y - ny },
                        { x: end.x - nx, y: end.y - ny },
                        { x: end.x + nx, y: end.y + ny },
                    ];
                }
            } else if (obj.type === "circle") {
                for (let i = 0; i < 16; i++) {
                    const th = (i / 16) * Math.PI * 2;
                    verts.push({
                        x: obj.c.x + Math.cos(th) * obj.radius,
                        y: obj.c.y + Math.sin(th) * obj.radius,
                    });
                }
            }

            if (verts.length >= 3) {
                const ring = verts.map((v) => ptRound(v.x, v.y));
                const f = ring[0],
                    l = ring[ring.length - 1];
                if (
                    Math.abs(f[0] - l[0]) > 0.001 ||
                    Math.abs(f[1] - l[1]) > 0.001
                )
                    ring.push([f[0], f[1]]);
                mapClipGeoms.push([ring]);
            }
        });

        // 3. Stamp Convex Primitives (Blocky / Hexagonal for efficiency)
        const outerPrims = [];
        const innerPrims = [];
        const spawn = State.get("spawnCircle");
        const spawnDiam = spawn ? spawn.diameter : 18;
        const MIN_DIST = spawnDiam / 2 + 2.5 + paddingVal;

        // Blocky 6-sided hexagon instead of an 8-sided circle drastically reduces edge counts
        const makePolyHex = (cx, cy, r) => {
            const pts = [];
            for (let j = 0; j < 6; j++)
                pts.push(
                    ptRound(
                        cx + Math.cos((j * Math.PI) / 3) * r,
                        cy + Math.sin((j * Math.PI) / 3) * r,
                    ),
                );
            pts.push([pts[0][0], pts[0][1]]);
            return forceCCW(pts);
        };

        const makeTrapezoid = (p1, p2, r1, r2) => {
            const dx = p2.x - p1.x,
                dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            if (len < 0.5) return null;
            const nx = -dy / len,
                ny = dx / len;
            const ring = [
                ptRound(p1.x + nx * r1, p1.y + ny * r1),
                ptRound(p1.x - nx * r1, p1.y - ny * r1),
                ptRound(p2.x - nx * r2, p2.y - ny * r2),
                ptRound(p2.x + nx * r2, p2.y + ny * r2),
            ];
            ring.push([ring[0][0], ring[0][1]]);
            return forceCCW(ring);
        };

        for (let i = 0; i < trace.length; i++) {
            let p = trace[i];

            // Subtle taper, no wavy warp
            let taperSteps = Math.min(15, trace.length / 4);
            let taper = 1.0;
            if (i < taperSteps) taper = Math.pow(i / taperSteps, 0.8);
            else if (i > trace.length - 1 - taperSteps)
                taper = Math.pow((trace.length - 1 - i) / taperSteps, 0.8);

            let strokeThick = 28; // Constant thickness ensures straight walls

            let outerR = MIN_DIST + strokeThick * taper;
            let innerR = MIN_DIST;
            let outerCx = p.x;
            let outerCy = p.y;

            trace[i].outerR = outerR;
            trace[i].innerR = innerR;
            trace[i].outerCx = outerCx;
            trace[i].outerCy = outerCy;

            outerPrims.push([makePolyHex(outerCx, outerCy, outerR)]);
            innerPrims.push([makePolyHex(p.x, p.y, innerR)]);
        }

        for (let i = 0; i < trace.length - 1; i++) {
            let p1 = trace[i],
                p2 = trace[i + 1];
            let tOuter = makeTrapezoid(
                { x: p1.outerCx, y: p1.outerCy },
                { x: p2.outerCx, y: p2.outerCy },
                p1.outerR,
                p2.outerR,
            );
            if (tOuter) outerPrims.push([tOuter]);
            let tInner = makeTrapezoid(p1, p2, p1.innerR, p2.innerR);
            if (tInner) innerPrims.push([tInner]);
        }

        // 4. Boolean Difference & Condense
        if (
            typeof window.polygonClipping === "undefined" ||
            typeof window.decomp === "undefined"
        ) {
            showToast("Required computational libraries missing.", true);
            return;
        }

        const batchedUnion = (prims, batchSize = 40) => {
            if (prims.length === 0) return [];
            let current = [];
            for (let i = 0; i < prims.length; i += batchSize) {
                let batch = prims.slice(i, i + batchSize);
                if (current.length === 0)
                    current = window.polygonClipping.union(...batch);
                else current = window.polygonClipping.union(current, ...batch);
            }
            return current;
        };

        let safeOuter = batchedUnion(outerPrims);
        let safeInner = batchedUnion(innerPrims);

        let carved;
        if (mapClipGeoms.length > 0)
            carved = window.polygonClipping.difference(
                safeOuter,
                safeInner,
                ...mapClipGeoms,
            );
        else carved = window.polygonClipping.difference(safeOuter, safeInner);

        const rawShards = [];
        carved.forEach((multi) => {
            let exteriorRing = multi[0];
            if (!exteriorRing || exteriorRing.length < 3) return;

            // Brutal 6.0 simplification removes all jagged boolean artifacts and flattens edges
            const pts = exteriorRing.map((p) => ({ x: p[0], y: p[1] }));
            const cleanedPts = rdpSimplify(pts, 6.0);
            if (cleanedPts.length < 3) return;

            let shapeForDecomp = cleanedPts.map((p) => [p.x, p.y]);
            window.decomp.makeCCW(shapeForDecomp);
            let convexPolys = window.decomp.quickDecomp(shapeForDecomp);

            if (convexPolys) {
                convexPolys.forEach((cp) => {
                    const verts = cp.map((p) => ({ x: p[0], y: p[1] }));
                    if (getPolyArea(verts) > 10) rawShards.push(verts);
                });
            }
        });

        // Smart Condense with a huge 15% (1.15) tolerance
        // Aggressively swallows ragged corners and splinter polygons into massive blocks
        const finalPolygons = smartCondense(rawShards, 1.15);

        // --- NEW: Vertex Snapping ---
        // Magnetically pulls vertices back to the exact map edge if they drifted away during RDP
        const snappedPolygons = snapPolygonsToMap(
            finalPolygons,
            mapClipGeoms,
            8.0,
        );

        // 5. Dispatch
        if (snappedPolygons.length > 0) {
            const stateColors = State.get("colors") || {};
            const deathColor = stateColors.death || "rgb(255, 0, 0)";
            const toCreate = [];

            snappedPolygons.forEach((finalVerts) => {
                let polyObj = createValidPolygonObject(finalVerts, "death", {
                    isDeath: true,
                });

                // Fallback maintains flush alignment on flat edges
                if (!polyObj) {
                    const hull = getConvexHull(finalVerts);
                    if (hull.length >= 3)
                        polyObj = createValidPolygonObject(hull, "death", {
                            isDeath: true,
                        });
                }
                if (polyObj) {
                    polyObj.polyType = "death";
                    polyObj.color = deathColor;
                    toCreate.push(polyObj);
                }
            });

            const generatedIds = toCreate.map(
                () => "tun_" + Math.random().toString(36).substr(2, 9),
            );
            toCreate.forEach((p, i) => (p.id = generatedIds[i]));

            Network.createObjectsBatch({
                objects: toCreate,
                isAutoGeneration: true,
            });
            State.set("selectedObjectIds", generatedIds);

            showToast(
                `Success! Crafted perfectly flush lava using ${toCreate.length} massive shapes.`,
                false,
            );
        } else {
            showToast("No geometry remained after processing.", true);
        }
    } catch (err) {
        console.error("Tunnel Generation Error:", err);
        showToast("Error processing complex geometry.", true);
    }
}
