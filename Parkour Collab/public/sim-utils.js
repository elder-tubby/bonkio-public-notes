import { distance } from "./utils-client.js";

// ----------------------------------------------------------------
// --- PHYSICS CONSTANTS ---
// ----------------------------------------------------------------
export const PHYSICS_SETTINGS = {
  TIME_STEP: 1 / 30,
  DRAG_FACTOR: -0.015,
  GRAVITY_FORCE: 3000,
  MOVE_ACCEL_FORCE: 1800,
  JUMP_FORCE: -1550,
  // NOTE: per your request, object bounciness is defined once here
  OBJ_BOUNCINESS: 0.8,
  // Ball can only jump if ground normal.y is <= this value
  // cos(29.5 degrees) = 0.8703
  MAX_JUMP_SLOPE_NORMAL: -0.8703,
  // Ball is considered "grounded" if normal.y is <= this value
  // cos(60 degrees) = 0.5
  MAX_GROUND_SLOPE_NORMAL: -0.5,
  JUMP_VELOCITY_TOLERANCE: 37, // must have |vel.y| <= this to be allowed to jump
};

// ----------------------------------------------------------------
// --- GEOMETRY HELPERS ---
// ----------------------------------------------------------------

/**
 * Rotates a 2D point around the origin (0,0).
 */
function rotatePoint(pt, angleDeg) {
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: pt.x * cos - pt.y * sin, y: pt.x * sin + pt.y * cos };
}

/**
 * Calculates the absolute-coordinate vertices of a state object.
 */
function getAbsoluteVertices(obj) {
  const a = obj.a || 0;
  const s = obj.scale || 1;
  const c = obj.c || { x: 0, y: 0 };
  const v = obj.v || [];

  return v.map((lv) => {
    const scaled = { x: lv.x * s, y: lv.y * s };
    const rotated = rotatePoint(scaled, a);
    return { x: c.x + rotated.x, y: c.y + rotated.y };
  });
}

/**
 * Parses the real-time objects from State into a simple list for the physics engine.
 * Polygons are broken down into their constituent lines.
 * @param {Array<Object>} stateObjects - The array from `State.get("objects")`
 * @returns {Array<Object>} A list of objects for `PhysicsMap`
 */
export function parseStateObjects(stateObjects) {
  const physicsObjects = [];
  if (!Array.isArray(stateObjects)) return [];

  for (const obj of stateObjects) {
    if (obj.noPhysics) continue;

    if (obj.type === "line") {
      const { start, end, height } = obj;
      if (!start || !end) continue;
      physicsObjects.push({
        id: obj.id,
        type: "line",
        start: obj.start,
        end: obj.end,
        height: height || 4,
        isDeath: obj.lineType === "death",
        isBouncy: obj.lineType === "bouncy",
      });
    } else if (obj.type === "circle") {
      const { c, radius } = obj;
      if (!c || !radius) continue;
      physicsObjects.push({
        id: obj.id,
        type: "circle",
        c: obj.c,
        radius: obj.radius,
        isDeath: obj.circleType === "death",
        isBouncy: obj.circleType === "bouncy",
      });
    } else if (obj.type === "poly") {
      const absVerts = getAbsoluteVertices(obj);
      if (absVerts.length < 2) continue;
      const isDeath = obj.polyType === "death";

      for (let i = 0; i < absVerts.length; i++) {
        const p1 = absVerts[i];
        const p2 = absVerts[(i + 1) % absVerts.length];
        physicsObjects.push({
          id: obj.id,
          type: "line", // not sure why this is line
          start: p1,
          end: p2,
          height: 4, // Polygons are treated as thin lines
          isDeath: isDeath,
          isBouncy: obj.polyType === "bouncy", // inherit the boolean
        });
      }
    }
  }
  return physicsObjects;
}

// ----------------------------------------------------------------
// --- PHYSICS PLAYER CLASS (REVISED) ---
// ----------------------------------------------------------------

export class PhysicsPlayer {
  constructor(x, y, radius) {
    this.pos = { x, y };
    this.vel = { x: 0, y: 0 };
    this.accel = { x: 0, y: 0 };
    this.radius = radius;
    this.mass = radius * 2;

    // NOTE: player-side bounciness is not used in collision resolution anymore.
    // Bounce occurs only when the *object* is marked `isBouncy`.

    this.isGrounded = true;
    this.wasGrounded = true;
    this.canJump = true;
  }

  /**
   * Resets the player's state to the spawn position.
   */
  respawn(spawnPos) {
    this.pos.x = spawnPos.x;
    this.pos.y = spawnPos.y;
    this.vel.x = 0;
    this.vel.y = 0;
    this.accel.x = 0;
    this.accel.y = 0;
    this.isGrounded = true;
    this.wasGrounded = true;
    this.canJump = true;
  }

  update(input, map) {
    const { TIME_STEP, JUMP_FORCE, JUMP_VELOCITY_TOLERANCE } = PHYSICS_SETTINGS;

    // Reset per-frame state
    this.isGrounded = false;
    this.canJump = false;

    this.applyInput(input);

    // Update velocity
    this.vel.x += this.accel.x * TIME_STEP;
    this.vel.y += this.accel.y * TIME_STEP;

    // Update position
    this.pos.x += this.vel.x * TIME_STEP;
    this.pos.y += this.vel.y * TIME_STEP;

    // Handle collisions (sets isGrounded / canJump)
    const collisionResult = this.handleCollisions(map);

    // --- Handle Jump Impulse (AFTER collisions) ---
    const isVelWithinJumpRange =
      this.vel.y >= -JUMP_VELOCITY_TOLERANCE &&
      this.vel.y <= JUMP_VELOCITY_TOLERANCE;

    if (input.up && this.isGrounded && this.canJump && isVelWithinJumpRange) {
      this.vel.y += JUMP_FORCE / this.mass;
      this.isGrounded = false;
      this.canJump = false;
    }

    this.wasGrounded = this.isGrounded;
    return collisionResult;
  }

  applyInput(input) {
    const { GRAVITY_FORCE, MOVE_ACCEL_FORCE, DRAG_FACTOR } = PHYSICS_SETTINGS;

    this.accel = { x: 0, y: 0 };

    // --- Vertical Acceleration (a = F / m) ---
    this.accel.y = GRAVITY_FORCE / this.mass; // Gravity
    if (input.up) {
      this.accel.y += -MOVE_ACCEL_FORCE / this.mass; // Up force
    }
    if (input.down) {
      this.accel.y += MOVE_ACCEL_FORCE / this.mass; // Down force
    }
    this.accel.y += this.vel.y * DRAG_FACTOR;

    // --- Horizontal Acceleration (a = F / m) ---
    if (input.left) {
      this.accel.x = -MOVE_ACCEL_FORCE / this.mass;
    } else if (input.right) {
      this.accel.x = MOVE_ACCEL_FORCE / this.mass;
    }
    this.accel.x += this.vel.x * DRAG_FACTOR;
  }

  // In sim-utils.js -> PhysicsPlayer class

  handleCollisions(map) {
    // Tolerance to count as grounded even if slightly floating (e.g. 0 gravity)
    const GROUND_TOLERANCE = 0.05;

    // --- NEW: Track all touched IDs and death status separately ---
    const touchedIds = new Set();
    let died = false;

    for (const obj of map.objects) {
      let info = { collided: false };

      if (obj.type === "line") {
        info = this.checkLineCollision(
          obj.start,
          obj.end,
          this.pos,
          this.radius,
          obj.height,
        );
      } else if (obj.type === "circle") {
        info = this.checkCircleCollision(
          obj.c,
          obj.radius,
          this.pos,
          this.radius,
        );
      }

      // 1. Handle Actual Physical Collision
      if (info.collided) {
        // Track the ID
        if (obj.id) touchedIds.add(obj.id);

        if (obj.isDeath) {
          touchedIds.clear();
          died = true;
        }

        // Positional correction (push out)
        const separationBias = 1e-3;
        this.pos.x += info.normal.x * (info.penetration + separationBias);
        this.pos.y += info.normal.y * (info.penetration + separationBias);

        const dot = this.vel.x * info.normal.x + this.vel.y * info.normal.y;

        // Ground detection
        if (info.normal.y <= PHYSICS_SETTINGS.MAX_GROUND_SLOPE_NORMAL) {
          this.isGrounded = true;
          if (info.normal.y <= PHYSICS_SETTINGS.MAX_JUMP_SLOPE_NORMAL) {
            this.canJump = true;
          }
        }

        // Velocity response (Bounce / Slide)
        if (dot < 0) {
          // --- CALCULATE DYNAMIC BOUNCINESS ---
          const pB = 0.95; // Player: fixed at 0.95, never changes
          const oB = obj.isBouncy ? 0.8 : -0.95; // Object: 0.8 if bouncy, 0.0 otherwise

          let effectiveBounciness = 0;

          if (pB > 0 && oB > 0) {
            // If both positive, take the max
            effectiveBounciness = Math.max(pB, oB);
          } else {
            // If one is negative (or both), combine them (add)
            effectiveBounciness = pB + oB;
          }

          // Clamp at 0.
          // If player (0.95) hits super sticky wall (-1.0),
          // result is -0.05 → clamp to 0 → full slide.
          effectiveBounciness = Math.max(0, effectiveBounciness);

          const v_normal_x = dot * info.normal.x;
          const v_normal_y = dot * info.normal.y;

          const v_tangential_x = this.vel.x - v_normal_x;
          const v_tangential_y = this.vel.y - v_normal_y;

          this.vel.x = v_tangential_x - v_normal_x * effectiveBounciness;
          this.vel.y = v_tangential_y - v_normal_y * effectiveBounciness;
        }
      }
      // 2. Handle "Near Miss" (Ground Proximity Check)
      else if (info.penetration > -GROUND_TOLERANCE) {
        // We are not colliding, but we are very close (within tolerance).
        // If the surface is floor-like, treat us as grounded.
        if (info.normal.y <= PHYSICS_SETTINGS.MAX_GROUND_SLOPE_NORMAL) {
          this.isGrounded = true;
          if (info.normal.y <= PHYSICS_SETTINGS.MAX_JUMP_SLOPE_NORMAL) {
            this.canJump = true;
          }
        }
      }
    }
    // Return structured result instead of simple string
    return { died, touchedIds: Array.from(touchedIds) };
  }

  checkLineCollision(p1, p2, circlePos, circleRadius, lineHeight) {
    const { dist, closestPoint } = getClosestPointOnLineSegment(
      p1,
      p2,
      circlePos,
    );
    const collisionThreshold = circleRadius + lineHeight / 2;
    const penetration = collisionThreshold - dist;

    // Calculate normal regardless of collision
    const normal =
      dist < 1e-6
        ? { x: 0, y: -1 }
        : {
            x: (circlePos.x - closestPoint.x) / dist,
            y: (circlePos.y - closestPoint.y) / dist,
          };

    // Return all data
    return {
      collided: dist <= collisionThreshold,
      penetration,
      normal,
      closestPoint,
    };
  }

  checkCircleCollision(circleC, circleR, ballPos, ballR) {
    const dist = distance(ballPos, circleC);
    const collisionThreshold = ballR + circleR;
    const penetration = collisionThreshold - dist;

    const normal =
      dist < 1e-6
        ? { x: 0, y: -1 }
        : {
            x: (ballPos.x - circleC.x) / dist,
            y: (ballPos.y - circleC.y) / dist,
          };

    return {
      collided: dist <= collisionThreshold,
      penetration,
      normal,
    };
  }
} // --- END OF PhysicsPlayer CLASS ---

export class PhysicsMap {
  constructor(objects, spawn) {
    this.objects = objects; // Will be updated every frame
    this.spawn = spawn; // Will be updated every frame
  }
}

function getClosestPointOnLineSegment(p1, p2, p) {
  const l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
  if (l2 === 0) return { dist: distance(p, p1), closestPoint: { ...p1 } };
  let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const closestPoint = {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y),
  };
  return { dist: distance(p, closestPoint), closestPoint };
}
