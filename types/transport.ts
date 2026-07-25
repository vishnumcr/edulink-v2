/**
 * --------------------------------------------------------------------
 * File:
 * types/transport.ts
 *
 * Purpose:
 * Shared types for the Transport feature — vehicles, routes/stops,
 * and trips (a trip links one vehicle to one route with timing).
 *
 * Firestore documents:
 * schools/{schoolId}/vehicles/{vehicleId}
 * schools/{schoolId}/routes/{routeId}
 * schools/{schoolId}/trips/{tripId}
 *
 * Route/RouteStop are also read by Fee Structure (per-stop transport
 * fees), via the read side of routesService — that contract is
 * unchanged here. Vehicle and Trip are new, consumed only by the
 * Transport config page for now.
 * --------------------------------------------------------------------
 */

export type VehicleType = "Bus" | "Van" | "Auto";

export interface RouteStop {
  name: string;
  /** Stop order along the route, 0-indexed. */
  order: number;
  transportFee: number;
}

export interface Route {
  id: string;
  routeName: string;
  routeCode?: string;
  isActive: boolean;
  stops: RouteStop[];
}

export interface Vehicle {
  id: string;
  vehicleNo: string;
  type: VehicleType;
  capacity: number;
  driverName: string;
  driverPhone: string;
  conductorName: string;
  conductorPhone: string;
  isActive: boolean;
}

/**
 * A Trip links a single Vehicle to a single Route with timing.
 * vehicleNo/routeName are denormalized onto the trip so list views
 * don't need a join on every render — vehicleId/routeId are kept for
 * edits and for filtering (e.g. "trips for this vehicle").
 */
export interface Trip {
  id: string;
  tripName: string;
  vehicleId: string;
  vehicleNo: string;
  routeId: string;
  routeName: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}