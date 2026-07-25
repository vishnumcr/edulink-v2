/**
 * --------------------------------------------------------------------
 * File:
 * services/transport/vehiclesService.ts
 *
 * Purpose:
 * Business logic for the Transport feature's vehicle data.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into well-formed Vehicle records
 * ✅ Validate and persist vehicle CRUD from the Transport config page
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * --------------------------------------------------------------------
 */

import { vehiclesRepository } from "@/repositories/transport/vehiclesRepository";
import { Vehicle, VehicleType } from "@/types/transport";

export type { Vehicle };

export interface VehicleInput {
  vehicleNo: string;
  type: VehicleType;
  capacity: number;
  driverName: string;
  driverPhone: string;
  conductorName: string;
  conductorPhone: string;
  isActive: boolean;
}

function normalizeVehicle(id: string, data: Record<string, unknown>): Vehicle {
  return {
    id,
    vehicleNo: (data.vehicleNo as string) || "",
    type: ((data.type as VehicleType) || "Bus"),
    capacity: (data.capacity as number) ?? 0,
    driverName: (data.driverName as string) || "",
    driverPhone: (data.driverPhone as string) || "",
    conductorName: (data.conductorName as string) || "",
    conductorPhone: (data.conductorPhone as string) || "",
    isActive: (data.isActive as boolean) ?? true,
  };
}

export class VehiclesService {
  subscribeToVehicles(
    schoolId: string,
    callback: (vehicles: Vehicle[]) => void
  ): () => void {
    return vehiclesRepository.subscribeToVehicles(schoolId, (docs) => {
      callback(docs.map((d) => normalizeVehicle(d.id, d.data)));
    });
  }

  private validate(input: VehicleInput): string | null {
    if (!input.vehicleNo.trim()) return "Vehicle number is required.";
    if (!input.driverName.trim()) return "Driver name is required.";
    if (!input.driverPhone.trim()) return "Driver phone is required.";
    return null;
  }

  async addVehicle(schoolId: string, input: VehicleInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const error = this.validate(input);
    if (error) return { ok: false, error };
    await vehiclesRepository.addVehicle(schoolId, input as unknown as Record<string, unknown>);
    return { ok: true };
  }

  async updateVehicle(
    schoolId: string,
    vehicleId: string,
    input: VehicleInput
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const error = this.validate(input);
    if (error) return { ok: false, error };
    await vehiclesRepository.updateVehicle(schoolId, vehicleId, input as unknown as Record<string, unknown>);
    return { ok: true };
  }

  async deleteVehicle(schoolId: string, vehicleId: string): Promise<void> {
    await vehiclesRepository.deleteVehicle(schoolId, vehicleId);
  }

  async toggleVehicleActive(schoolId: string, vehicleId: string, currentlyActive: boolean): Promise<void> {
    await vehiclesRepository.updateVehicle(schoolId, vehicleId, { isActive: !currentlyActive });
  }
}

export const vehiclesService = new VehiclesService();