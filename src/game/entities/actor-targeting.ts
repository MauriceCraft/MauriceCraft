/** Allocation-free ray versus actor-box targeting. */
export interface WorldPoint { x: number; y: number; z: number }
export interface TargetableActor extends WorldPoint {
  r: number;
  h: number;
}
export interface ActorHit<Actor extends TargetableActor> {
  mob: Actor;
  t: number;
}

/**
 * Finds the first intersected actor inside the player's reach.
 *
 * Time: O(actors.length); additional space: O(1).
 * Uses the same axis-aligned hitbox geometry as the original game,
 * without allocating six arrays for every actor each frame.
 */
export function raycastActors<Actor extends TargetableActor>(
  actors: readonly Actor[],
  origin: WorldPoint,
  direction: WorldPoint,
  maxDistance: number,
): ActorHit<Actor> | null {
  let closestActor: Actor | null = null;
  let closestDistance = maxDistance;
  for (const actor of actors) {
    let enter = 0;
    let exit = closestDistance;
    const minX = actor.x - actor.r;
    const maxX = actor.x + actor.r;
    const minY = actor.y;
    const maxY = actor.y + actor.h;
    const minZ = actor.z - actor.r;
    const maxZ = actor.z + actor.r;

    if (Math.abs(direction.x) < 1e-8) {
      if (origin.x < minX || origin.x > maxX) continue;
    } else {
      let near = (minX - origin.x) / direction.x;
      let far = (maxX - origin.x) / direction.x;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      exit = Math.min(exit, far);
      if (enter > exit) continue;
    }
    if (Math.abs(direction.y) < 1e-8) {
      if (origin.y < minY || origin.y > maxY) continue;
    } else {
      let near = (minY - origin.y) / direction.y;
      let far = (maxY - origin.y) / direction.y;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      exit = Math.min(exit, far);
      if (enter > exit) continue;
    }
    if (Math.abs(direction.z) < 1e-8) {
      if (origin.z < minZ || origin.z > maxZ) continue;
    } else {
      let near = (minZ - origin.z) / direction.z;
      let far = (maxZ - origin.z) / direction.z;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      exit = Math.min(exit, far);
      if (enter > exit) continue;
    }
    if (enter <= exit && enter < closestDistance) {
      closestActor = actor;
      closestDistance = enter;
    }
  }
  return closestActor ? { mob: closestActor, t: closestDistance } : null;
}
