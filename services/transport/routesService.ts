/**
 * --------------------------------------------------------------------
 * File:
 * services/transport/routesService.ts
 *
 * Purpose:
 * Business logic for the Transport feature's route data. Read side is
 * also consumed by Fee Structure's transport tab (per-stop fees) —
 * that contract (subscribeToRoutes → normalized Route[]) is unchanged.
 *
 * Responsibilities:
 * ✅ Normalize raw Firestore data into well-formed Route records
 * ✅ Validate and persist route/stop CRUD from the Transport config page
 *
 * Does NOT:
 * ❌ Call Firestore directly (that's the repository's job)
 * --------------------------------------------------------------------
 */

import { routesRepository } from "@/repositories/transport/routesRepository";
import { Route, RouteStop } from "@/types/transport";

export type { Route, RouteStop };

export interface RouteInput {
  routeName: string;
  routeCode?: string;
  stops: RouteStop[];
  isActive: boolean;
}

function normalizeStop(raw: Record<string, unknown>): RouteStop {
  return {
    name: (raw.name as string) || "",
    order: (raw.order as number) ?? 0,
    transportFee: (raw.transportFee as number) ?? 0,
  };
}

function normalizeRoute(id: string, data: Record<string, unknown>): Route {
  const rawStops = (data.stops as Record<string, unknown>[] | undefined) ?? [];

  return {
    id,
    routeName: (data.routeName as string) || "",
    routeCode: data.routeCode as string | undefined,
    isActive: (data.isActive as boolean) ?? true,
    stops: rawStops.map(normalizeStop),
  };
}

export class RoutesService {
  /**
   * ----------------------------------------------------
   * Live subscription to a school's routes, normalized.
   * ----------------------------------------------------
   */
  subscribeToRoutes(
    schoolId: string,
    callback: (routes: Route[]) => void
  ): () => void {
    return routesRepository.subscribeToRoutes(schoolId, (docs) => {
      callback(docs.map((d) => normalizeRoute(d.id, d.data)));
    });
  }

  /**
   * ----------------------------------------------------
   * Validates and re-numbers stop order (0-indexed, matching
   * types/transport.ts) before persisting — the page shouldn't have
   * to worry about keeping `order` in sync when stops are reordered
   * or removed.
   * ----------------------------------------------------
   */
  private prepareRoute(input: RouteInput): { valid: true; data: RouteInput } | { valid: false; error: string } {
    if (!input.routeName.trim()) return { valid: false, error: "Route name is required." };
    if (input.stops.length < 2) return { valid: false, error: "Add at least 2 stops to the route." };

    return {
      valid: true,
      data: {
        ...input,
        stops: input.stops.map((s, i) => ({ ...s, order: i })),
      },
    };
  }

  async addRoute(schoolId: string, input: RouteInput): Promise<{ ok: true } | { ok: false; error: string }> {
    const prepared = this.prepareRoute(input);
    if (!prepared.valid) return { ok: false, error: prepared.error };
    await routesRepository.addRoute(schoolId, prepared.data as unknown as Record<string, unknown>);
    return { ok: true };
  }

  async updateRoute(
    schoolId: string,
    routeId: string,
    input: RouteInput
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const prepared = this.prepareRoute(input);
    if (!prepared.valid) return { ok: false, error: prepared.error };
    await routesRepository.updateRoute(schoolId, routeId, prepared.data as unknown as Record<string, unknown>);
    return { ok: true };
  }

  async deleteRoute(schoolId: string, routeId: string): Promise<void> {
    await routesRepository.deleteRoute(schoolId, routeId);
  }

  async toggleRouteActive(schoolId: string, routeId: string, currentlyActive: boolean): Promise<void> {
    await routesRepository.updateRoute(schoolId, routeId, { isActive: !currentlyActive });
  }
}

export const routesService = new RoutesService();