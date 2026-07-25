/**
 * --------------------------------------------------------------------
 * File:
 * services/transport/tripsService.ts
 *
 * Purpose:
 * Business logic for the Transport feature's trip data. A trip links
 * one vehicle to one route with timing.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into well-formed Trip records
 * ✅ Validate a trip and resolve/denormalize vehicleNo + routeName
 *    from the selected vehicle/route before persisting
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * ❌ Fetch vehicles/routes itself — the page already has them
 *    subscribed via vehiclesService/routesService and passes the
 *    matched records in
 * --------------------------------------------------------------------
 */

import { tripsRepository } from "@/repositories/transport/tripsRepository";
import { Trip } from "@/types/transport";
import { Vehicle } from "@/types/transport";
import { Route } from "@/types/transport";

export type { Trip };

export interface TripInput {
  tripName: string;
  vehicleId: string;
  routeId: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

function normalizeTrip(id: string, data: Record<string, unknown>): Trip {
  return {
    id,
    tripName: (data.tripName as string) || "",
    vehicleId: (data.vehicleId as string) || "",
    vehicleNo: (data.vehicleNo as string) || "",
    routeId: (data.routeId as string) || "",
    routeName: (data.routeName as string) || "",
    startTime: (data.startTime as string) || "",
    endTime: (data.endTime as string) || "",
    isActive: (data.isActive as boolean) ?? true,
  };
}

export class TripsService {
  subscribeToTrips(
    schoolId: string,
    callback: (trips: Trip[]) => void
  ): () => void {
    return tripsRepository.subscribeToTrips(schoolId, (docs) => {
      const trips = docs
        .map((d) => normalizeTrip(d.id, d.data))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      callback(trips);
    });
  }

  tripsForVehicle(trips: Trip[], vehicleId: string): Trip[] {
    return trips
      .filter((t) => t.vehicleId === vehicleId)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  tripsForRoute(trips: Trip[], routeId: string): Trip[] {
    return trips.filter((t) => t.routeId === routeId);
  }

  private prepare(
    input: TripInput,
    vehicle: Vehicle | undefined,
    route: Route | undefined
  ): { valid: true; data: Record<string, unknown> } | { valid: false; error: string } {
    if (!input.tripName.trim()) return { valid: false, error: "Trip name is required." };
    if (!input.vehicleId) return { valid: false, error: "Select a vehicle." };
    if (!input.routeId) return { valid: false, error: "Select a route." };
    if (!input.startTime) return { valid: false, error: "Start time is required." };
    if (!input.endTime) return { valid: false, error: "End time is required." };
    if (!vehicle || !route) return { valid: false, error: "Invalid vehicle or route." };

    return {
      valid: true,
      data: {
        tripName: input.tripName,
        vehicleId: input.vehicleId,
        vehicleNo: vehicle.vehicleNo,
        routeId: input.routeId,
        routeName: route.routeName,
        startTime: input.startTime,
        endTime: input.endTime,
        isActive: input.isActive,
      },
    };
  }

  async addTrip(
    schoolId: string,
    input: TripInput,
    vehicle: Vehicle | undefined,
    route: Route | undefined
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const prepared = this.prepare(input, vehicle, route);
    if (!prepared.valid) return { ok: false, error: prepared.error };
    await tripsRepository.addTrip(schoolId, prepared.data);
    return { ok: true };
  }

  async updateTrip(
    schoolId: string,
    tripId: string,
    input: TripInput,
    vehicle: Vehicle | undefined,
    route: Route | undefined
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const prepared = this.prepare(input, vehicle, route);
    if (!prepared.valid) return { ok: false, error: prepared.error };
    await tripsRepository.updateTrip(schoolId, tripId, prepared.data);
    return { ok: true };
  }

  async deleteTrip(schoolId: string, tripId: string): Promise<void> {
    await tripsRepository.deleteTrip(schoolId, tripId);
  }
}

export const tripsService = new TripsService();