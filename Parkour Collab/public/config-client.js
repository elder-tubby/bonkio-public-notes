// public/config-client.js
// This file centralizes configuration for UI elements, like popup limits.

export const AUTO_GEN_LIMITS = {
  maxPolygons: { min: 1, max: 200, default: 50 },
  minDistance: { min: 0, max: 200, default: 10 },
  maxVertices: { min: 3, max: 30, default: 12 },
  minArea: { min: 200, max: 50000, default: 8000 },
  maxArea: { min: 300, max: 50000, default: 30000 },
  skipChance: { min: 0, max: 1, default: 0, step: 0.1 },
  tunnelPadding: { min: 10, max: 100, default: 30 },
};