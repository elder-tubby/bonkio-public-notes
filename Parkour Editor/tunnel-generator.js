// tunnel-generator.js
import State from "./state.js";
import * as LocalStore from "./local-store.js";
import UI from "./ui.js";
import { showToast } from "./utils-client.js";

// ==========================================
// 1. DATA PARSING & MATH HELPERS
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

function walkPath(points, spacing) {
    let resampled = [];
    if (points.length === 0) return resampled;
    resampled.push({ x: points[0].x, y: points[0].y });
    let d = 0;
    for (let i = 1; i < points.length; i++) {
        let p0 = points[i - 1], p1 = points[i];
        let dx = p1.x - p0.x, dy = p1.y - p0.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.001) continue;
        let dirX = dx / dist, dirY = dy / dist, distLeft = dist;
        while (d + distLeft >= spacing) {
            let take = spacing - d;
            resampled.push({ x: p1.x - dirX * (distLeft - take), y: p1.y - dirY * (distLeft - take) });
            distLeft -= take;
            d = 0;
        }
        d += distLeft;
    }
    let lastP = resampled[resampled.length - 1], endP = points[points.length - 1];
    if (Math.hypot(lastP.x - endP.x, lastP.y - endP.y) > spacing * 0.2) resampled.push({ x: endP.x, y: endP.y });
    return resampled;
}

function smoothPath(points, iterations) {
    if (points.length < 3) return points;
    let current = points;
    for (let it = 0; it < iterations; it++) {
        const next = [current[0]];
        for (let i = 0; i < current.length - 1; i++) {
            const p0 = current[i], p1 = current[i + 1];
            next.push({ x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y });
            next.push({ x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y });
        }
        next.push(current[current.length - 1]);
        current = next;
    }
    return current;
}

// --- Strict Geometry Functions ---
const distance = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);
const ptDistSq = (p1, p2) => (p1.x - p2.x)*(p1.x - p2.x) + (p1.y - p2.y)*(p1.y - p2.y);

function linesIntersect(p1, p2, p3, p4) {
    let det = (p2.x - p1.x) * (p4.y - p3.y) - (p4.x - p3.x) * (p2.y - p1.y);
    if (det === 0) return false;
    let lambda = ((p4.y - p3.y) * (p4.x - p1.x) + (p3.x - p4.x) * (p4.y - p1.y)) / det;
    let gamma = ((p1.y - p2.y) * (p4.x - p1.x) + (p2.x - p1.x) * (p4.y - p1.y)) / det;
    return (-0.001 <= lambda && lambda <= 1.001) && (-0.001 <= gamma && gamma <= 1.001);
}

function distToSegment(p, v, w) {
    const l2 = ptDistSq(v, w);
    if (l2 === 0) return distance(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distance(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function segmentDistance(p1, p2, p3, p4) {
    if (linesIntersect(p1, p2, p3, p4)) return 0;
    return Math.min(distToSegment(p3, p1, p2), distToSegment(p4, p1, p2), distToSegment(p1, p3, p4), distToSegment(p2, p3, p4));
}

function rdpSimplify(points, epsilon) {
    if (points.length <= 2) return points;
    let dmax = 0, index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
        const d = distToSegment(points[i], points[0], points[end]);
        if (d > dmax) { index = i; dmax = d; }
    }
    if (dmax > epsilon) {
        const r1 = rdpSimplify(points.slice(0, index + 1), epsilon);
        const r2 = rdpSimplify(points.slice(index), epsilon);
        return r1.slice(0, r1.length - 1).concat(r2);
    } else return [points[0], points[end]];
}

function simplifyPoly(verts, epsilon = 0.5) {
    if (verts.length <= 3) return verts;
    let clean = [];
    for (let i = 0; i < verts.length; i++) {
        let prev = verts[(i - 1 + verts.length) % verts.length], curr = verts[i], next = verts[(i + 1) % verts.length];
        let area = Math.abs((prev.x*(curr.y - next.y) + curr.x*(next.y - prev.y) + next.x*(prev.y - curr.y))/2);
        if (area > epsilon) clean.push(curr);
    }
    return clean.length >= 3 ? clean : verts;
}

function getSignedArea(verts) {
    let area = 0;
    for (let i = 0; i < verts.length; i++) {
        let j = (i + 1) % verts.length;
        area += (verts[i].x * verts[j].y) - (verts[j].x * verts[i].y);
    }
    return area;
}

function forceCW(verts) {
    if (verts.length < 3) return verts;
    if (getSignedArea(verts) < 0) return [...verts].reverse();
    return verts;
}

function getPolyBounds(verts) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let v of verts) {
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function getPolyArea(verts) {
    return Math.abs(getSignedArea(verts) / 2);
}

function pointInPoly(pt, polyVerts) {
    let inside = false;
    for (let i = 0, j = polyVerts.length - 1; i < polyVerts.length; j = i++) {
        let xi = polyVerts[i].x, yi = polyVerts[i].y;
        let xj = polyVerts[j].x, yj = polyVerts[j].y;
        let intersect = ((yi > pt.y) != (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function isSelfIntersecting(verts) {
    for(let i=0; i<verts.length; i++) {
        let a1 = verts[i], a2 = verts[(i+1)%verts.length];
        for(let j=i+2; j<verts.length; j++) {
            if(i===0 && j===verts.length-1) continue; 
            let b1 = verts[j], b2 = verts[(j+1)%verts.length];
            if(linesIntersect(a1, a2, b1, b2)) return true;
        }
    }
    return false;
}

function isStrictlyConvex(verts) {
    if (verts.length <= 3) return !isSelfIntersecting(verts);
    let cleanVerts = forceCW(verts);
    let isPositive = null;
    for (let i = 0; i < cleanVerts.length; i++) {
        let p0 = cleanVerts[i]; let p1 = cleanVerts[(i + 1) % cleanVerts.length]; let p2 = cleanVerts[(i + 2) % cleanVerts.length];
        let cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
        if (Math.abs(cross) < 0.1) continue; 
        if (isPositive === null) isPositive = cross > 0;
        else if ((cross > 0) !== isPositive) return false;
    }
    return !isSelfIntersecting(cleanVerts);
}

function pointInTriangle(p, a, b, c) {
    let as_x = p.x - a.x, as_y = p.y - a.y;
    let s_ab = (b.x - a.x) * as_y - (b.y - a.y) * as_x > 0;
    if (((c.x - a.x) * as_y - (c.y - a.y) * as_x > 0) == s_ab) return false;
    if (((c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x) > 0) != s_ab) return false;
    return true;
}

function triangulate(verts) {
    let vCpy = forceCW([...verts]); 
    let triangles = []; let limit = vCpy.length * 3; 
    
    while (vCpy.length >= 3 && limit-- > 0) {
        let n = vCpy.length; let earFound = false;
        for (let i = 0; i < n; i++) {
            let prev = vCpy[(i - 1 + n) % n], curr = vCpy[i], next = vCpy[(i + 1) % n];
            let cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
            if (cross > 0.001) { 
                let isEar = true;
                for (let j = 0; j < n; j++) {
                    if (j === (i - 1 + n) % n || j === i || j === (i + 1) % n) continue;
                    if (pointInTriangle(vCpy[j], prev, curr, next)) { isEar = false; break; }
                }
                if (isEar) {
                    triangles.push(forceCW([prev, curr, next]));
                    vCpy.splice(i, 1); earFound = true; break;
                }
            }
        }
        if (!earFound) vCpy.reverse(); 
    }
    if(triangles.length === 0 && verts.length === 3) triangles.push(forceCW(verts));
    return triangles;
}

function optimizeToMinimumConvex(triangles) {
    let pieces = [...triangles];
    let changed = true;
    while(changed) {
        changed = false;
        for(let i=0; i<pieces.length; i++) {
            for(let j=i+1; j<pieces.length; j++) {
                let mergedVerts = null; 
                let pA = pieces[i], pB = pieces[j];
                
                for (let a = 0; a < pA.length; a++) {
                    let a1 = pA[a], a2 = pA[(a + 1) % pA.length];
                    for (let b = 0; b < pB.length; b++) {
                        let b1 = pB[b], b2 = pB[(b + 1) % pB.length];
                        
                        if (ptDistSq(a1, b2) < 0.1 && ptDistSq(a2, b1) < 0.1) {
                            let stitched = [];
                            let currA = (a + 1) % pA.length;
                            while (currA !== a) { stitched.push(pA[currA]); currA = (currA + 1) % pA.length; }
                            stitched.push(pA[a]); 
                            
                            let currB = (b + 1) % pB.length;
                            while (currB !== b) {
                                if (ptDistSq(pB[currB], a1) > 0.1 && ptDistSq(pB[currB], a2) > 0.1) stitched.push(pB[currB]);
                                currB = (currB + 1) % pB.length;
                            }
                            
                            stitched = forceCW(stitched);
                            if (isStrictlyConvex(stitched)) mergedVerts = simplifyPoly(stitched, 0.1); 
                        }
                    }
                }
                if (mergedVerts) {
                    pieces.splice(j, 1); pieces[i] = mergedVerts; changed = true; break;
                }
            }
            if(changed) break; 
        }
    }
    return pieces;
}

function convexHull(points) {
    if(points.length <= 3) return forceCW(points);
    let pts = [...points].sort((a, b) => Math.abs(a.x - b.x) < 1e-6 ? a.y - b.y : a.x - b.x);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (let p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        let p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop(); lower.pop();
    return forceCW(lower.concat(upper));
}

// Strictly checks if two polygons intersect or are within a margin
function doPolygonsIntersect(polyA, polyB, margin = 0) {
    let bA = getPolyBounds(polyA), bB = getPolyBounds(polyB);
    if (bA.maxX < bB.minX - margin || bA.minX > bB.maxX + margin || bA.maxY < bB.minY - margin || bA.minY > bB.maxY + margin) return false;

    for (let p of polyA) if (pointInPoly(p, polyB)) return true;
    for (let p of polyB) if (pointInPoly(p, polyA)) return true;
    
    for (let i=0; i<polyA.length; i++) {
        let a1 = polyA[i], a2 = polyA[(i+1)%polyA.length];
        for (let j=0; j<polyB.length; j++) {
            let b1 = polyB[j], b2 = polyB[(j+1)%polyB.length];
            if (margin > 0) {
                if (segmentDistance(a1, a2, b1, b2) < margin) return true;
            } else {
                if (linesIntersect(a1, a2, b1, b2)) return true;
            }
        }
    }
    return false;
}

function segmentDistanceToPoly(p1, p2, poly) {
    let minDist = Infinity;
    for(let i=0; i<poly.length; i++) {
        let a = poly[i], b = poly[(i+1)%poly.length];
        let d = segmentDistance(p1, p2, a, b);
        if (d < minDist) minDist = d;
    }
    if (pointInPoly(p1, poly) || pointInPoly(p2, poly)) return 0;
    return minDist;
}

// Ensures a proposed hull does not swallow any existing level geometry
function isHullSafe(hull, trace, collPolys, collSegs, collCircs, capCenter, spawn, paddingVal) {
    const MIN_DIST_ROUTE = paddingVal - 1;   
    const CLEARANCE = 4; // Margin to prevent structural overlapping
    
    let hB = getPolyBounds(hull);
    
    for(let i=0; i<trace.length-1; i++) {
        let p1 = trace[i], p2 = trace[i+1];
        if (hB.maxX < Math.min(p1.x, p2.x) - MIN_DIST_ROUTE || hB.minX > Math.max(p1.x, p2.x) + MIN_DIST_ROUTE ||
            hB.maxY < Math.min(p1.y, p2.y) - MIN_DIST_ROUTE || hB.minY > Math.max(p1.y, p2.y) + MIN_DIST_ROUTE) continue;

        if (segmentDistanceToPoly(p1, p2, hull) < MIN_DIST_ROUTE) return false;
    }
    
    for(let cp of collPolys) if (doPolygonsIntersect(hull, cp.verts, CLEARANCE)) return false;
    for(let seg of collSegs) if (segmentDistanceToPoly(seg.p1, seg.p2, hull) < seg.h + CLEARANCE) return false;
    for(let c of collCircs) if (segmentDistanceToPoly(c, c, hull) < c.r + CLEARANCE) return false;
    
    if (segmentDistanceToPoly(spawn, spawn, hull) < CLEARANCE) return false;
    if (capCenter && segmentDistanceToPoly(capCenter, capCenter, hull) < CLEARANCE) return false;
    
    return true;
}

// High performance global hull aggregator
function globalMergeClosePolygons(pieces, trace, collPolys, collSegs, collCircs, spawn, capCenter, paddingVal) {
    let polys = [...pieces];

    const passes = [
        { maxBloatRatio: 1.01, maxDist: 2 },   
        { maxBloatRatio: 1.05, maxDist: 10 },  
        { maxBloatRatio: 1.15, maxDist: 20 },  
        { maxBloatRatio: 1.30, maxDist: 40 },  
        { maxBloatRatio: 1.60, maxDist: 80 }  
    ];

    for (let pass of passes) {
        let changed = true; 
        let iter = 0;
        
        while(changed && iter < 300) {
            changed = false; 
            iter++;
            let validCandidates = [];

            for(let i = 0; i < polys.length; i++) {
                let pA = polys[i], bA = getPolyBounds(pA), aA = getPolyArea(pA);
                for(let j = i + 1; j < polys.length; j++) {
                    let pB = polys[j], bB = getPolyBounds(pB);
                    
                    let distX = Math.max(0, Math.max(bA.minX - bB.maxX, bB.minX - bA.maxX));
                    let distY = Math.max(0, Math.max(bA.minY - bB.maxY, bB.minY - bA.maxY));

                    if (distX > pass.maxDist || distY > pass.maxDist) continue;
                        
                    let hull = convexHull(pA.concat(pB));
                    let aB = getPolyArea(pB);
                    let hArea = getPolyArea(hull);
                    
                    let bloatRatio = hArea / ((aA + aB) || 1e-6);
                    if (bloatRatio <= pass.maxBloatRatio) {
                        let score = bloatRatio + (Math.max(distX, distY) * 0.005);
                        validCandidates.push({ i, j, score, hull });
                    }
                }
            }
            
            validCandidates.sort((a, b) => a.score - b.score);
            
            for (let candidate of validCandidates) {
                if (isHullSafe(candidate.hull, trace, collPolys, collSegs, collCircs, capCenter, spawn, paddingVal)) {
                    polys.splice(candidate.j, 1);
                    polys.splice(candidate.i, 1);
                    polys.push(candidate.hull);
                    changed = true;
                    break; 
                }
            }
        }
    }
    return polys;
}

// ==========================================
// 2. MAIN ORGANIC TUNNEL GENERATOR ENGINE
// ==========================================
export async function generateDeathTunnel(paddingVal) {
    try {
        showToast("Reading clipboard data...", false);
        let text = await navigator.clipboard.readText();
        if (!text || text.trim() === "") { showToast("Clipboard is empty.", true); return; }

        let pathData;
        try { pathData = JSON.parse(text); } 
        catch (e) { showToast("Clipboard data is not valid JSON.", true); return; }

        const rawPoints = extractPoints(pathData);
        if (rawPoints.length < 2) { showToast("Found less than 2 valid points.", true); return; }

        showToast("Sculpting flawless organic tunnel...", false);

        const canvas = UI.elems.canvas;
        const GW = canvas ? canvas.width : 730;
        const GH = canvas ? canvas.height : 500;
        const gamePoints = rawPoints.map((p) => convertPkrToGame(p.x, p.y, GW, GH));

        // 1. Smooth path
        const trace = rdpSimplify(smoothPath(walkPath(gamePoints, 10), 3), 2.0);
        if (trace.length < 2) { showToast("Path is too short.", true); return; }

        // 2. Pre-process Collision Geometries for exact organic hugging
        const objects = State.get("objects") || [];
        const collPolys = [];
        const collSegs = [];
        const collCircs = [];

        objects.forEach(obj => {
            if (obj.isBgLine || obj.isZone || obj.isZoneIndicator || obj.isCapzone || obj.noPhysics || obj.polyType === 'death' || obj.lineType === 'death' || obj.circleType === 'death') return;
            
            if (obj.type === "poly") {
                const a = obj.a || 0, s = obj.scale || 1, c = obj.c;
                const r = a * Math.PI / 180;
                const cos = Math.cos(r), sin = Math.sin(r);
                const absV = (obj.v || []).map(lv => { return { x: c.x + (lv.x * s * cos - lv.y * s * sin), y: c.y + (lv.x * s * sin + lv.y * s * cos) }; });
                collPolys.push({ verts: absV, bounds: getPolyBounds(absV) });
            } else if (obj.type === "line") {
                const start = obj.start, angle = obj.angle || 0, width = obj.width || 0, h = (obj.height || 4) / 2;
                const end = obj.end || { x: start.x + Math.cos(angle * Math.PI / 180) * width, y: start.y + Math.sin(angle * Math.PI / 180) * width };
                collSegs.push({ 
                    p1: start, p2: end, h: h, 
                    bounds: { minX: Math.min(start.x, end.x)-h, maxX: Math.max(start.x, end.x)+h, minY: Math.min(start.y, end.y)-h, maxY: Math.max(start.y, end.y)+h } 
                });
            } else if (obj.type === "circle") {
                collCircs.push({ x: obj.c.x, y: obj.c.y, r: obj.radius });
            }
        });

        const spawn = State.get("spawnCircle") || { x: 365, y: 450, diameter: 18 };
        const capObj = State.get("capZone");
        const capCenter = (capObj && capObj.x !== null) ? { x: capObj.x + capObj.width/2, y: capObj.y + capObj.height/2 } : null;

        const spawnDiam = spawn.diameter || 18;
        const MIN_DIST_ROUTE = spawnDiam / 2 + paddingVal;
        const MAX_DIST_ROUTE = MIN_DIST_ROUTE + 25; 
        
        let totalTraceLength = 0;
        let traceProgress = [0];
        for(let i=0; i<trace.length-1; i++) {
            totalTraceLength += Math.hypot(trace[i+1].x - trace[i].x, trace[i+1].y - trace[i].y);
            traceProgress.push(totalTraceLength);
        }

        const res = 5; 
        const cols = Math.ceil(GW / res) + 1;
        const rows = Math.ceil(GH / res) + 1;
        const grid = new Float32Array(cols * rows);
        const numChunks = Math.floor(Math.random() * 3) + 3;

        function distSq(px, py, x1, y1, x2, y2) {
            let l2 = (x2 - x1)*(x2 - x1) + (y2 - y1)*(y2 - y1);
            if (l2 === 0) return (px - x1)*(px - x1) + (py - y1)*(py - y1);
            let t = Math.max(0, Math.min(1, ((px - x1)*(x2 - x1) + (py - y1)*(y2 - y1)) / l2));
            return (px - (x1 + t*(x2 - x1)))**2 + (py - (y1 + t*(y2 - y1)))**2;
        }

        // 3. Grid-based Signed Distance Field (SDF) mathematically avoids ALL objects
        for(let y=0; y<rows; y++) {
            for(let x=0; x<cols; x++) {
                let px = x * res, py = y * res;
                let minDtSq = Infinity;
                let closestProgress = 0;
                
                for(let i=0; i<trace.length-1; i++) {
                    let p1 = trace[i], p2 = trace[i+1];
                    let dsq = distSq(px, py, p1.x, p1.y, p2.x, p2.y);
                    if(dsq < minDtSq) {
                        minDtSq = dsq;
                        let segLenSq = (p2.x - p1.x)**2 + (p2.y - p1.y)**2;
                        let t = segLenSq > 0 ? Math.max(0, Math.min(1, ((px - p1.x)*(p2.x - p1.x) + (py - p1.y)*(p2.y - p1.y)) / segLenSq)) : 0;
                        closestProgress = traceProgress[i] + t * Math.sqrt(segLenSq);
                    }
                }
                
                let dt = Math.sqrt(minDtSq);
                let progressNorm = closestProgress / (totalTraceLength || 1);

                // Smooth "artist brush" width variations
                let wave = Math.abs(Math.sin(progressNorm * Math.PI * numChunks));
                let localThick = (MAX_DIST_ROUTE - MIN_DIST_ROUTE + 5) * Math.pow(wave, 0.6) - 5; 
                localThick += Math.sin(progressNorm * Math.PI * 40) * 1.5;

                // Taper cleanly at ends
                let taper = 1.0;
                if (progressNorm < 0.08) taper = progressNorm / 0.08;
                else if (progressNorm > 0.92) taper = (1.0 - progressNorm) / 0.08;
                taper = 0.5 - 0.5 * Math.cos(taper * Math.PI);
                localThick *= taper;

                let val = Math.min(dt - MIN_DIST_ROUTE, (MIN_DIST_ROUTE + localThick) - dt);

                // Elegant Spawn & CapZone Envelope
                let ds = Math.hypot(px - spawn.x, py - spawn.y);
                if (ds < 120) {
                    let rx = trace[Math.min(10, trace.length-1)].x - trace[0].x; 
                    let ry = trace[Math.min(10, trace.length-1)].y - trace[0].y;
                    let len = Math.hypot(rx, ry);
                    if (len > 0 && ((px - spawn.x) * rx + (py - spawn.y) * ry) / (ds * len) < 0.1) val = Math.max(val, 120 - ds);
                }

                if (capCenter) {
                    let dc = Math.hypot(px - capCenter.x, py - capCenter.y);
                    if (dc < 120) {
                        let rx = trace[trace.length-1].x - trace[Math.max(0, trace.length-11)].x; 
                        let ry = trace[trace.length-1].y - trace[Math.max(0, trace.length-11)].y;
                        let len = Math.hypot(rx, ry);
                        if (len > 0 && ((px - capCenter.x) * rx + (py - capCenter.y) * ry) / (dc * len) > -0.1) val = Math.max(val, 120 - dc);
                    }
                }

                // ========================================================
                // EXACT COLLISION CARVING (Hugs platforms perfectly)
                // ========================================================
                if (val > 0) {
                    let distToObstacle = Infinity;

                    for (let cp of collPolys) {
                        if (px < cp.bounds.minX-10 || px > cp.bounds.maxX+10 || py < cp.bounds.minY-10 || py > cp.bounds.maxY+10) continue;
                        let inside = pointInPoly({x: px, y: py}, cp.verts);
                        let dEdge = Infinity;
                        for (let i=0; i<cp.verts.length; i++) {
                            let d = segmentDistance({x:px,y:py}, {x:px,y:py}, cp.verts[i], cp.verts[(i+1)%cp.verts.length]);
                            if (d < dEdge) dEdge = d;
                        }
                        let dFinal = inside ? -dEdge : dEdge;
                        if (dFinal < distToObstacle) distToObstacle = dFinal;
                    }

                    for (let cs of collSegs) {
                        if (px < cs.bounds.minX-10 || px > cs.bounds.maxX+10 || py < cs.bounds.minY-10 || py > cs.bounds.maxY+10) continue;
                        let d = Math.sqrt(distSq(px, py, cs.p1.x, cs.p1.y, cs.p2.x, cs.p2.y)) - cs.h;
                        if (d < distToObstacle) distToObstacle = d;
                    }

                    for (let cc of collCircs) {
                        let d = Math.hypot(px - cc.x, py - cc.y) - cc.r;
                        if (d < distToObstacle) distToObstacle = d;
                    }

                    // A strict 6-pixel clearance ensures smoothing curves never accidentally intersect
                    if (distToObstacle - 6 < val) {
                        val = distToObstacle - 6;
                    }

                    if (ds - 18 < val) val = ds - 18;
                    if (capCenter && Math.hypot(px - capCenter.x, py - capCenter.y) - 18 < val) val = Math.hypot(px - capCenter.x, py - capCenter.y) - 18;
                }
                
                if (dt < MIN_DIST_ROUTE) val = Math.min(val, dt - MIN_DIST_ROUTE);
                if (val === 0) val = 1e-5;
                grid[y * cols + x] = val;
            }
        }

        // 4. Marching Squares Edge Table Extraction
        const edgeTable = [ [], [[3,0]], [[0,1]], [[3,1]], [[1,2]], [[3,0],[1,2]], [[0,2]], [[3,2]], [[2,3]], [[2,0]], [[0,1],[2,3]], [[2,1]], [[1,3]], [[1,0]], [[0,3]], [] ];
        function getPt(edgeIdx, x, y, v0, v1, v2, v3) {
            let px = x * res, py = y * res;
            if (edgeIdx === 0) return { x: px + res * (0 - v0)/(v1 - v0), y: py };
            if (edgeIdx === 1) return { x: px + res, y: py + res * (0 - v1)/(v2 - v1) };
            if (edgeIdx === 2) return { x: px + res * (0 - v3)/(v2 - v3), y: py + res };
            if (edgeIdx === 3) return { x: px, y: py + res * (0 - v0)/(v3 - v0) };
        }

        let segments = [];
        for(let y=0; y<rows-1; y++) {
            for(let x=0; x<cols-1; x++) {
                let v0 = grid[y*cols + x], v1 = grid[y*cols + x+1], v2 = grid[(y+1)*cols + x+1], v3 = grid[(y+1)*cols + x];
                let state = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
                for(let edge of edgeTable[state]) segments.push({ p1: getPt(edge[0], x, y, v0, v1, v2, v3), p2: getPt(edge[1], x, y, v0, v1, v2, v3) });
            }
        }

        let allConvexPolys = [];
        while(segments.length > 0) {
            let poly = []; let curr = segments.pop();
            poly.push(curr.p1, curr.p2);
            let head = curr.p1, tail = curr.p2, added = true;
            
            while(added && segments.length > 0) {
                added = false;
                for(let i=0; i<segments.length; i++) {
                    let s = segments[i]; const EPS = 0.01;
                    if (Math.hypot(s.p1.x - tail.x, s.p1.y - tail.y) < EPS) { poly.push(s.p2); tail = s.p2; segments.splice(i, 1); added = true; break; } 
                    else if (Math.hypot(s.p2.x - tail.x, s.p2.y - tail.y) < EPS) { poly.push(s.p1); tail = s.p1; segments.splice(i, 1); added = true; break; } 
                    else if (Math.hypot(s.p1.x - head.x, s.p1.y - head.y) < EPS) { poly.unshift(s.p2); head = s.p2; segments.splice(i, 1); added = true; break; } 
                    else if (Math.hypot(s.p2.x - head.x, s.p2.y - head.y) < EPS) { poly.unshift(s.p1); head = s.p1; segments.splice(i, 1); added = true; break; }
                }
            }
            
            if(poly.length > 6) {
                // Smoothing gives it the beautiful fluid brush stroke shape
                let smoothed = [...poly];
                for (let it = 0; it < 3; it++) {
                    let next = [];
                    for (let i = 0; i < smoothed.length; i++) {
                        let prev = smoothed[(i - 1 + smoothed.length) % smoothed.length], curr = smoothed[i], nxt = smoothed[(i + 1) % smoothed.length];
                        next.push({ x: curr.x * 0.5 + (prev.x + nxt.x) * 0.25, y: curr.y * 0.5 + (prev.y + nxt.y) * 0.25 });
                    }
                    smoothed = next;
                }
                
                let finalPoly = forceCW(simplifyPoly(smoothed, 0.4));
                if (finalPoly.length >= 3) {
                    if (isStrictlyConvex(finalPoly)) {
                        allConvexPolys.push(finalPoly);
                    } else {
                        let triangles = triangulate(finalPoly);
                        let minConvex = optimizeToMinimumConvex(triangles);
                        allConvexPolys.push(...minConvex);
                    }
                }
            }
        }
        
        // 5. Final Aggressive Collision-Aware Optimization
        let safelyMergedConvex = globalMergeClosePolygons(allConvexPolys, trace, collPolys, collSegs, collCircs, spawn, capCenter, MIN_DIST_ROUTE);
        
        const stateColors = State.get("colors") || {};
        const deathColor = stateColors.death || "rgb(255, 0, 0)";
        const toCreate = [];

        for(let cp of safelyMergedConvex) {
            if (getPolyArea(cp) < 20) continue; // Drop invisible artifacts
            let cx = 0, cy = 0;
            cp.forEach(v => { cx += v.x; cy += v.y; });
            cx /= cp.length; cy /= cp.length;
            
            toCreate.push({
                type: "poly",
                c: { x: cx, y: cy },
                v: forceCW(cp).map(p => ({ x: p.x - cx, y: p.y - cy })),
                a: 0,
                scale: 1,
                polyType: "death",
                color: deathColor,
                isDeath: true,
                isBouncy: false
            });
        }

        if (toCreate.length > 0) {
            const generatedIds = toCreate.map(() => "tun_" + Math.random().toString(36).substr(2, 9));
            toCreate.forEach((p, i) => (p.id = generatedIds[i]));

            LocalStore.createObjectsBatch({ objects: toCreate, isAutoGeneration: true });
            State.set("selectedObjectIds", generatedIds);
            showToast(`Success! Sculpted organic tunnel bounding existing shapes.`, false);
        } else {
            showToast("No geometry remained after processing.", true);
        }
    } catch (err) {
        console.error("Tunnel Generation Error:", err);
        showToast("Error processing complex geometry.", true);
    }
}