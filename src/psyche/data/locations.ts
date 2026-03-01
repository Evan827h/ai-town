/**
 * Location zone definitions for the "gentle" map (64 wide x 48 tall).
 *
 * Each zone defines a rectangular area on the map and a destination point
 * for pathfinding. The agent walks to the destination when they need to
 * reach a location for an action.
 *
 * IMPORTANT: Destination points MUST be on walkable tiles (objmap[layer][x][y] === -1).
 * The campfire/windmill objects are on object layer 0 and are NOT walkable.
 *
 * Map landmarks:
 *   - Campfire at ~(44, 11) — object tile, blocked; walkable at (45, 11)
 *   - Waterfall at (23-26, 10-13) — scenic water feature
 *   - Building rooms in upper-left (4-16, 3-11) — enclosed spaces
 *   - Wide open grassland at (48-63, 17-20) — fully walkable
 *   - Right side (48-52, 3-13) — narrow walkable corridor
 */

import { LocationZone, LocationId, LocationRegistry } from '../registries';

const locationZones: LocationZone[] = [
  {
    id: 'home',
    name: 'Home',
    // Upper-left building interior — enclosed rooms with walls
    x0: 4,
    y0: 3,
    x1: 16,
    y1: 11,
    destination: { x: 8, y: 5 },
  },
  {
    id: 'cafe',
    name: 'Cafe',
    // Around the campfire — natural social gathering spot
    // Campfire object is at ~(44,11) but blocked; destination is adjacent walkable tile
    x0: 42,
    y0: 8,
    x1: 47,
    y1: 14,
    destination: { x: 45, y: 11 },
  },
  {
    id: 'park',
    name: 'Park',
    // Right side of map — narrow corridor (y=3-13) + wide open grassland (y=17-20)
    x0: 48,
    y0: 0,
    x1: 63,
    y1: 22,
    destination: { x: 50, y: 18 },
  },
  {
    id: 'waterfall',
    name: 'Waterfall',
    // West bank of river near waterfall — contemplative zone
    x0: 17,
    y0: 8,
    x1: 23,
    y1: 16,
    destination: { x: 20, y: 12 },
  },
  {
    id: 'meadow',
    name: 'Meadow',
    // Open grassland south of Home — flowers, stumps, mushrooms
    x0: 5,
    y0: 16,
    x1: 18,
    y1: 28,
    destination: { x: 10, y: 22 },
  },
  {
    id: 'workshop',
    name: 'Workshop',
    // Windmill area with crates — productive zone
    x0: 28,
    y0: 8,
    x1: 40,
    y1: 16,
    destination: { x: 33, y: 12 },
  },
];

export const locationRegistry: LocationRegistry = new Map(
  locationZones.map((z) => [z.id, z]),
);

/**
 * Determine which location zone a position falls within.
 * Returns the zone ID or 'unknown' if not in any defined zone.
 */
export function getLocationAtPosition(position: { x: number; y: number }): string {
  for (const zone of locationZones) {
    if (
      position.x >= zone.x0 &&
      position.x <= zone.x1 &&
      position.y >= zone.y0 &&
      position.y <= zone.y1
    ) {
      return zone.id;
    }
  }
  return 'unknown';
}

/**
 * Get the destination point for a location zone.
 * Used when the agent needs to walk to a specific location.
 */
export function getLocationDestination(locationId: string): { x: number; y: number } | undefined {
  return locationRegistry.get(locationId as LocationId)?.destination;
}

/** Get all defined zones (for debug overlay rendering) */
export function getAllZones(): LocationZone[] {
  return locationZones;
}
