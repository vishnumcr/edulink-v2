/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/transport/page.tsx
 *
 * Ported from the old prototype's TransportConfigPage. Same UI and
 * hierarchy (Vehicles / Routes / Trips as independent, linked
 * entities — a Trip links one Vehicle to one Route with timing).
 *
 * Changes from the original:
 * - No direct Firestore calls — routes through vehiclesService,
 *   routesService, tripsService (routesService's read side is shared
 *   with Fee Structure, which already depended on it).
 * - CSS import path fixed: '@/styles/config-transport.css', matching
 *   where config-fees.css / config-academic.css / config-general.css
 *   actually live (the original pointed at '@/app/styles/...', which
 *   doesn't exist in this project).
 * - Route stop order is now assigned by the service (0-indexed, per
 *   types/transport.ts) instead of the page incrementing it by hand.
 * - Trip save/validation (name, vehicle, route, times, resolving
 *   vehicleNo/routeName) moved into tripsService.
 * --------------------------------------------------------------------
 */

'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { vehiclesService } from '@/services/transport/vehiclesService';
import { routesService } from '@/services/transport/routesService';
import { tripsService } from '@/services/transport/tripsService';
import { Vehicle, VehicleType, Route, RouteStop, Trip } from '@/types/transport';
import {
  Bus, Plus, X, Pencil, Trash2, User,
  MapPin, Check, Loader2, AlertCircle, ChevronRight,
  Navigation, Route as RouteIcon, Clock, ArrowRight,
} from 'lucide-react';
import '@/styles/config-transport.css';

// ── Local form types ─────────────────────────────────────────────────────────
// Firestore document shapes live in types/transport.ts; these are just
// the editable subsets used by the drawers (no id/timestamps).

type TabKey = 'vehicles' | 'routes' | 'trips';

const VEHICLE_TYPES: VehicleType[] = ['Bus', 'Van', 'Auto'];

const EMPTY_VEHICLE: Omit<Vehicle, 'id'> = {
  vehicleNo: '', type: 'Bus', capacity: 40,
  driverName: '', driverPhone: '', conductorName: '', conductorPhone: '',
  isActive: true,
};

const EMPTY_ROUTE: Omit<Route, 'id'> = {
  routeName: '',
  routeCode: '',
  stops: [],
  isActive: true,
};

const EMPTY_TRIP = {
  tripName: '',
  vehicleId: '',
  routeId: '',
  startTime: '',
  endTime: '',
  isActive: true,
};

const TYPE_META: Record<VehicleType, { bg: string; color: string; border: string }> = {
  Bus : { bg: '#FFFBEB', color: '#D97706', border: '#FDE68A' },
  Van : { bg: '#EFF6FF', color: '#2563EB', border: '#BFDBFE' },
  Auto: { bg: '#F0FDF4', color: '#16A34A', border: '#BBF7D0' },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function TransportConfigPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [tab, setTab] = useState<TabKey>('vehicles');
  const [loading, setLoading] = useState(true);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes,   setRoutes  ] = useState<Route[]>([]);
  const [trips,    setTrips   ] = useState<Trip[]>([]);

  const [selectedV, setSelectedV] = useState<Vehicle | null>(null);
  const [selectedR, setSelectedR] = useState<Route | null>(null);

  // drawers
  const [vDrawer, setVDrawer] = useState(false);
  const [rDrawer, setRDrawer] = useState(false);
  const [tDrawer, setTDrawer] = useState(false);

  const [vEdit, setVEdit] = useState<Vehicle | null>(null);
  const [rEdit, setREdit] = useState<Route | null>(null);
  const [tEdit, setTEdit] = useState<Trip | null>(null);

  const [vForm, setVForm] = useState<Omit<Vehicle, 'id'>>(EMPTY_VEHICLE);
  const [rForm, setRForm] = useState<Omit<Route, 'id'>>(EMPTY_ROUTE);
  const [tForm, setTForm] = useState(EMPTY_TRIP);

  const [stopName, setStopName] = useState('');
  const [stopFee, setStopFee] = useState<number>(0);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{ kind: TabKey; id: string } | null>(null);

  // ── Subscriptions (via services — no Firestore imports here) ────────────
  useEffect(() => {
    if (!schoolId) return;
    const unsubs = [
      vehiclesService.subscribeToVehicles(schoolId, (rows) => {
        setVehicles(rows);
        setLoading(false);
      }),
      routesService.subscribeToRoutes(schoolId, setRoutes),
      tripsService.subscribeToTrips(schoolId, setTrips),
    ];
    return () => unsubs.forEach((u) => u());
  }, [schoolId]);

  const vehicleById = (id: string) => vehicles.find(v => v.id === id);
  const routeById   = (id: string) => routes.find(r => r.id === id);
  const tripsForVehicle = (vehicleId: string) => tripsService.tripsForVehicle(trips, vehicleId);

  // ── Vehicle CRUD ─────────────────────────────────────────────────────────
  function openAddVehicle() {
    setVEdit(null); setVForm(EMPTY_VEHICLE); setFormError(''); setVDrawer(true);
  }
  function openEditVehicle(v: Vehicle) {
    setVEdit(v);
    setVForm({
      vehicleNo: v.vehicleNo, type: v.type, capacity: v.capacity,
      driverName: v.driverName, driverPhone: v.driverPhone,
      conductorName: v.conductorName, conductorPhone: v.conductorPhone,
      isActive: v.isActive,
    });
    setFormError(''); setVDrawer(true);
  }
  async function saveVehicle() {
    if (!schoolId) return;
    setSaving(true); setFormError('');
    try {
      const result = vEdit?.id
        ? await vehiclesService.updateVehicle(schoolId, vEdit.id, vForm)
        : await vehiclesService.addVehicle(schoolId, vForm);

      if (!result.ok) { setFormError(result.error); return; }

      if (vEdit?.id && selectedV?.id === vEdit.id) setSelectedV({ ...selectedV, ...vForm });
      setVDrawer(false);
    } catch (e) { console.error(e); setFormError('Failed to save. Please try again.'); }
    finally { setSaving(false); }
  }

  // ── Route CRUD ───────────────────────────────────────────────────────────
  function openAddRoute() {
    setREdit(null); setRForm(EMPTY_ROUTE); setStopName(''); setFormError(''); setRDrawer(true);
  }
  function openEditRoute(r: Route) {
    setREdit(r);
    setRForm({
      routeName: r.routeName,
      routeCode: r.routeCode,
      stops: [...r.stops],
      isActive: r.isActive,
    });
    setStopName(''); setFormError(''); setRDrawer(true);
  }
  function addStop() {
    if (!stopName.trim()) return;
    setRForm(f => ({
      ...f,
      stops: [
        ...f.stops,
        { name: stopName.trim(), transportFee: stopFee, order: f.stops.length },
      ],
    }));
    setStopName('');
    setStopFee(0);
  }
  function removeStop(idx: number) {
    setRForm(f => ({ ...f, stops: f.stops.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })) }));
  }
  async function saveRoute() {
    if (!schoolId) return;
    setSaving(true); setFormError('');
    try {
      const result = rEdit?.id
        ? await routesService.updateRoute(schoolId, rEdit.id, rForm)
        : await routesService.addRoute(schoolId, rForm);

      if (!result.ok) { setFormError(result.error); return; }

      if (rEdit?.id && selectedR?.id === rEdit.id) setSelectedR({ ...selectedR, ...rForm });
      setRDrawer(false);
    } catch (e) { console.error(e); setFormError('Failed to save. Please try again.'); }
    finally { setSaving(false); }
  }

  // ── Trip CRUD ────────────────────────────────────────────────────────────
  function openAddTrip() {
    setTEdit(null); setTForm(EMPTY_TRIP); setFormError(''); setTDrawer(true);
  }
  function openEditTrip(t: Trip) {
    setTEdit(t);
    setTForm({
      tripName: t.tripName,
      vehicleId: t.vehicleId,
      routeId: t.routeId,
      startTime: t.startTime,
      endTime: t.endTime,
      isActive: t.isActive,
    });
    setFormError(''); setTDrawer(true);
  }
  async function saveTrip() {
    if (!schoolId) return;
    setSaving(true); setFormError('');
    try {
      const vehicle = vehicleById(tForm.vehicleId);
      const route = routeById(tForm.routeId);

      const result = tEdit?.id
        ? await tripsService.updateTrip(schoolId, tEdit.id, tForm, vehicle, route)
        : await tripsService.addTrip(schoolId, tForm, vehicle, route);

      if (!result.ok) { setFormError(result.error); return; }

      setTDrawer(false);
    } catch (e) { console.error(e); setFormError('Failed to save trip.'); }
    finally { setSaving(false); }
  }

  // ── Shared toggle / delete ──────────────────────────────────────────────
  async function toggleActive(kind: TabKey, id: string, current: boolean) {
    if (!schoolId) return;
    if (kind === 'vehicles') await vehiclesService.toggleVehicleActive(schoolId, id, current);
    if (kind === 'routes')   await routesService.toggleRouteActive(schoolId, id, current);
    // Trips don't have an inline toggle in this UI (only via the drawer's Active switch).
  }
  async function handleDelete() {
    if (!schoolId || !deleteTarget) return;
    if (deleteTarget.kind === 'vehicles') await vehiclesService.deleteVehicle(schoolId, deleteTarget.id);
    if (deleteTarget.kind === 'routes')   await routesService.deleteRoute(schoolId, deleteTarget.id);
    if (deleteTarget.kind === 'trips')    await tripsService.deleteTrip(schoolId, deleteTarget.id);

    if (deleteTarget.kind === 'vehicles' && selectedV?.id === deleteTarget.id) setSelectedV(null);
    if (deleteTarget.kind === 'routes'   && selectedR?.id === deleteTarget.id) setSelectedR(null);
    setDeleteTarget(null);
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  const activeVehicles = vehicles.filter(v => v.isActive).length;
  const activeRoutes   = routes.filter(r => r.isActive).length;
  const activeTrips    = trips.filter(t => t.isActive).length;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '0.75rem' }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#0F172A' }} />
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Loading transport…
      </span>
    </div>
  );

  return (
    <>
      <div className="tp">

        {/* Topbar */}
        <div className="tp-topbar">
          <div className="tp-topbar-left">
            <h1>Transport</h1>
            <p>Vehicles, routes &amp; trips — student assignments and reports live in their own sections</p>
          </div>
          {tab === 'vehicles' && <button className="tp-btn tp-btn-primary" onClick={openAddVehicle}><Plus size={13} /> Add Vehicle</button>}
          {tab === 'routes'   && <button className="tp-btn tp-btn-primary" onClick={openAddRoute}><Plus size={13} /> Add Route</button>}
          {tab === 'trips'    && <button className="tp-btn tp-btn-primary" onClick={openAddTrip}><Plus size={13} /> Add Trip</button>}
        </div>

        {/* Tabs */}
        <div className="tp-tabs">
          <div className={`tp-tab${tab === 'vehicles' ? ' sel' : ''}`} onClick={() => setTab('vehicles')}>
            <Bus size={13} /> Vehicles <span className="tp-tab-count">{vehicles.length}</span>
          </div>
          <div className={`tp-tab${tab === 'routes' ? ' sel' : ''}`} onClick={() => setTab('routes')}>
            <RouteIcon size={13} /> Routes <span className="tp-tab-count">{routes.length}</span>
          </div>
          <div className={`tp-tab${tab === 'trips' ? ' sel' : ''}`} onClick={() => setTab('trips')}>
            <Navigation size={13} /> Trips <span className="tp-tab-count">{trips.length}</span>
          </div>
        </div>

        {/* Stats strip */}
        <div className="tp-strip">
          {[
            { icon: <Bus size={11}/>,      label: 'Vehicles', val: vehicles.length, sub: `${activeVehicles} active` },
            { icon: <RouteIcon size={11}/>,label: 'Routes',   val: routes.length,   sub: `${activeRoutes} active` },
            { icon: <Navigation size={11}/>,label: 'Trips',    val: trips.length,    sub: `${activeTrips} active` },
          ].map(s => (
            <div className="tp-strip-item" key={s.label}>
              <span className="tp-strip-label">{s.icon} {s.label}</span>
              <span className="tp-strip-val">{s.val}</span>
              <span className="tp-strip-sub">{s.sub}</span>
            </div>
          ))}
        </div>

        {/* ── VEHICLES TAB ─────────────────────────────────────────────── */}
        {tab === 'vehicles' && (
          <div className="tp-body">
            <div className="tp-list">
              <div className="tp-list-head"><span className="tp-list-title">Vehicles</span><span className="tp-list-count">{vehicles.length}</span></div>
              {vehicles.length === 0 ? (
                <EmptyState icon={<Bus size={28} />} title="No vehicles yet" sub='Click "Add Vehicle" to get started' />
              ) : vehicles.map(v => {
                const meta = TYPE_META[v.type];
                const tCount = tripsForVehicle(v.id).length;
                return (
                  <div key={v.id} className={`tp-row${selectedV?.id === v.id ? ' active' : ''}${!v.isActive ? ' inactive' : ''}`} onClick={() => setSelectedV(v)}>
                    <div className="tp-row-icon" style={{ background: meta.bg, color: meta.color }}><Bus size={15} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tp-row-name">{v.vehicleNo}</div>
                      <div className="tp-row-sub">{tCount} trip{tCount === 1 ? '' : 's'} assigned</div>
                    </div>
                    <div className="tp-row-badge" style={{ background: meta.bg, color: meta.color, borderColor: meta.border }}>{v.type}</div>
                  </div>
                );
              })}
            </div>

            <div className="tp-detail">
              {!selectedV ? (
                <div className="tp-detail-empty"><div className="tp-detail-empty-ring"><Bus size={20} /></div><p>Select a vehicle to view details</p></div>
              ) : (
                <>
                  <div className="tp-detail-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: 42, height: 42, borderRadius: 11, background: TYPE_META[selectedV.type].bg, color: TYPE_META[selectedV.type].color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Bus size={18} /></div>
                      <div>
                        <div className="tp-detail-vehicle">{selectedV.vehicleNo}</div>
                        <div className="tp-detail-route">{selectedV.capacity} seats · {selectedV.type}</div>
                      </div>
                    </div>
                    <div className="tp-detail-actions">
                      <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{selectedV.isActive ? 'Active' : 'Inactive'}</span>
                      <button className={`tp-toggle ${selectedV.isActive ? 'on' : 'off'}`} onClick={() => toggleActive('vehicles', selectedV.id, selectedV.isActive)} />
                      <button className="tp-btn tp-btn-outline" onClick={() => openEditVehicle(selectedV)}><Pencil size={12} /> Edit</button>
                      <button className="tp-btn tp-btn-danger" onClick={() => setDeleteTarget({ kind: 'vehicles', id: selectedV.id })}><Trash2 size={12} /> Delete</button>
                    </div>
                  </div>

                  <div className="tp-detail-body">
                    <div className="tp-card">
                      <div className="tp-card-head"><div className="tp-card-head-left"><div className="tp-card-head-icon"><User size={12} /></div><span className="tp-card-title">Driver &amp; Conductor</span></div></div>
                      <div className="tp-info-grid">
                        {[
                          { l: 'Driver Name', v: selectedV.driverName || '—' },
                          { l: 'Driver Phone', v: selectedV.driverPhone || '—', mono: true },
                          { l: 'Conductor Name', v: selectedV.conductorName || '—' },
                          { l: 'Conductor Phone', v: selectedV.conductorPhone || '—', mono: true },
                        ].map(r => (
                          <div className="tp-info-item" key={r.l}><div className="tp-info-label">{r.l}</div><div className={`tp-info-val${r.mono ? ' mono' : ''}`}>{r.v}</div></div>
                        ))}
                      </div>
                    </div>

                    <div className="tp-card">
                      <div className="tp-card-head">
                        <div className="tp-card-head-left"><div className="tp-card-head-icon"><Navigation size={12} /></div><span className="tp-card-title">Trips on this vehicle ({tripsForVehicle(selectedV.id).length})</span></div>
                        <button className="tp-btn tp-btn-outline tp-btn-sm" onClick={openAddTrip}><Plus size={11} /> Add Trip</button>
                      </div>
                      {tripsForVehicle(selectedV.id).length === 0 ? (
                        <div style={{ padding: '1rem 1.1rem', fontSize: '0.75rem', color: '#94A3B8' }}>No trips assigned to this vehicle yet.</div>
                      ) : tripsForVehicle(selectedV.id).map((t, i) => {
                        const r = routeById(t.routeId);
                        return (
                          <div className="tp-trip-row" key={t.id}>
                            <div className="tp-trip-idx">{i + 1}</div>
                            <div>
                              <div className="tp-trip-route">{r?.routeName  || 'Unknown route'}</div>
                              <div className="tp-trip-time"><Clock size={10} /> {t.startTime} <ArrowRight size={10} /> {t.endTime}</div>
                            </div>
                            <div className="tp-trip-actions">
                              <button className="tp-btn-ghost" onClick={() => openEditTrip(t)}><Pencil size={13} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── ROUTES TAB ───────────────────────────────────────────────── */}
        {tab === 'routes' && (
          <div className="tp-body">
            <div className="tp-list">
              <div className="tp-list-head"><span className="tp-list-title">Routes</span><span className="tp-list-count">{routes.length}</span></div>
              {routes.length === 0 ? (
                <EmptyState icon={<RouteIcon size={28} />} title="No routes yet" sub='Click "Add Route" to create one' />
              ) : routes.map(r => (
                <div key={r.id} className={`tp-row${selectedR?.id === r.id ? ' active' : ''}${!r.isActive ? ' inactive' : ''}`} onClick={() => setSelectedR(r)}>
                  <div className="tp-row-icon" style={{ background: '#EFF6FF', color: '#2563EB' }}><RouteIcon size={15} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tp-row-name">{r.routeName}</div>
                    <div className="tp-row-sub">{r.stops.length} stops{r.routeCode ? ` · ${r.routeCode}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="tp-detail">
              {!selectedR ? (
                <div className="tp-detail-empty"><div className="tp-detail-empty-ring"><RouteIcon size={20} /></div><p>Select a route to view its stops</p></div>
              ) : (
                <>
                  <div className="tp-detail-head">
                    <div>
                      <div className="tp-detail-vehicle">{selectedR.routeName}</div>
                      <div className="tp-detail-route">{selectedR.routeCode ? `Code: ${selectedR.routeCode}` : 'No route code'}</div>
                    </div>
                    <div className="tp-detail-actions">
                      <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>{selectedR.isActive ? 'Active' : 'Inactive'}</span>
                      <button className={`tp-toggle ${selectedR.isActive ? 'on' : 'off'}`} onClick={() => toggleActive('routes', selectedR.id, selectedR.isActive)} />
                      <button className="tp-btn tp-btn-outline" onClick={() => openEditRoute(selectedR)}><Pencil size={12} /> Edit</button>
                      <button className="tp-btn tp-btn-danger" onClick={() => setDeleteTarget({ kind: 'routes', id: selectedR.id })}><Trash2 size={12} /> Delete</button>
                    </div>
                  </div>
                  <div className="tp-detail-body">
                    <div className="tp-card">
                      <div className="tp-card-head"><div className="tp-card-head-left"><div className="tp-card-head-icon"><MapPin size={12} /></div><span className="tp-card-title">Stops ({selectedR.stops.length})</span></div></div>
                      <div className="tp-stops">
                        {selectedR.stops.map((s, i) => (
                          <div className="tp-stop-row" key={i}>
                            <div className={`tp-stop-dot${i === 0 ? ' first' : i === selectedR.stops.length - 1 ? ' last' : ''}`}>
                              {(i === 0 || i === selectedR.stops.length - 1) && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                            </div>
                            <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
                              <span className="tp-stop-name">{s.name}</span>
                              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#16A34A' }}>₹{s.transportFee || 0}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="tp-card">
                      <div className="tp-card-head"><div className="tp-card-head-left"><div className="tp-card-head-icon"><Navigation size={12} /></div><span className="tp-card-title">Trips using this route</span></div></div>
                      {tripsService.tripsForRoute(trips, selectedR.id).length === 0 ? (
                        <div style={{ padding: '1rem 1.1rem', fontSize: '0.75rem', color: '#94A3B8' }}>No trips use this route yet.</div>
                      ) : tripsService.tripsForRoute(trips, selectedR.id).map((t, i) => {
                        const v = vehicleById(t.vehicleId);
                        return (
                          <div className="tp-trip-row" key={t.id}>
                            <div className="tp-trip-idx">{i + 1}</div>
                            <div>
                              <div className="tp-trip-route">{v?.vehicleNo || 'Unknown vehicle'}</div>
                              <div className="tp-trip-time"><Clock size={10} /> {t.startTime} <ArrowRight size={10} /> {t.endTime}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── TRIPS TAB ────────────────────────────────────────────────── */}
        {tab === 'trips' && (
          <div className="tp-body" style={{ display: 'block', overflowY: 'auto' }}>
            <div className="tp-detail-body" style={{ maxWidth: 900, margin: '0 auto' }}>
              {trips.length === 0 ? (
                <div className="tp-detail-empty"><div className="tp-detail-empty-ring"><Navigation size={20} /></div><p>No trips yet — add one to link a vehicle to a route</p></div>
              ) : (
                <div className="tp-card">
                  <div className="tp-card-head"><div className="tp-card-head-left"><div className="tp-card-head-icon"><Navigation size={12} /></div><span className="tp-card-title">All Trips ({trips.length})</span></div></div>
                  {trips.map((t, i) => {
                    const v = vehicleById(t.vehicleId);
                    const r = routeById(t.routeId);
                    return (
                      <div className="tp-trip-row" key={t.id}>
                        <div className="tp-trip-idx">{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div className="tp-trip-route">{v?.vehicleNo || '—'} <ChevronRight size={11} style={{ display: 'inline', color: '#CBD5E1' }} /> {r?.routeName || '—'}</div>
                          <div className="tp-trip-time"><Clock size={10} /> {t.startTime} <ArrowRight size={10} /> {t.endTime}{!t.isActive && '  · inactive'}</div>
                        </div>
                        <div className="tp-trip-actions">
                          <button className="tp-btn-ghost" onClick={() => openEditTrip(t)}><Pencil size={13} /></button>
                          <button className="tp-btn-ghost" onClick={() => setDeleteTarget({ kind: 'trips', id: t.id })}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Vehicle Drawer ───────────────────────────────────────────────── */}
      {vDrawer && (
        <div className="tp-overlay" onClick={() => setVDrawer(false)}>
          <div className="tp-drawer" onClick={e => e.stopPropagation()}>
            <div className="tp-drawer-head">
              <div>
                <div className="tp-drawer-title">{vEdit ? 'Edit Vehicle' : 'Add Vehicle'}</div>
                <div className="tp-drawer-sub">Vehicle and staff information only — routes are managed separately</div>
              </div>
              <button className="tp-drawer-close" onClick={() => setVDrawer(false)}><X size={13} /></button>
            </div>
            <div className="tp-drawer-body">
              {formError && <div className="tp-error"><AlertCircle size={13} />{formError}</div>}

              <div className="tp-section-label">Vehicle</div>
              <div className="tp-field">
                <label className="tp-label">Vehicle Number <span>*</span></label>
                <input className="tp-input mono" placeholder="e.g. TS09AB1234" value={vForm.vehicleNo} onChange={e => setVForm(f => ({ ...f, vehicleNo: e.target.value }))} />
              </div>
              <div className="tp-field">
                <label className="tp-label">Type</label>
                <div className="tp-type-row">
                  {VEHICLE_TYPES.map(t => (
                    <button key={t} className={`tp-type-btn${vForm.type === t ? ' sel' : ''}`} onClick={() => setVForm(f => ({ ...f, type: t }))}><Bus size={12} /> {t}</button>
                  ))}
                </div>
              </div>
              <div className="tp-field">
                <label className="tp-label">Capacity (seats)</label>
                <input type="number" min={1} className="tp-input mono" placeholder="40" value={vForm.capacity || ''} onChange={e => setVForm(f => ({ ...f, capacity: parseInt(e.target.value) || 0 }))} />
              </div>

              <div className="tp-section-label">Driver</div>
              <div className="tp-grid-2">
                <div className="tp-field"><label className="tp-label">Name <span>*</span></label><input className="tp-input" placeholder="Driver full name" value={vForm.driverName} onChange={e => setVForm(f => ({ ...f, driverName: e.target.value }))} /></div>
                <div className="tp-field"><label className="tp-label">Phone <span>*</span></label><input className="tp-input mono" placeholder="+91 00000 00000" value={vForm.driverPhone} onChange={e => setVForm(f => ({ ...f, driverPhone: e.target.value }))} /></div>
              </div>

              <div className="tp-section-label">Conductor</div>
              <div className="tp-grid-2">
                <div className="tp-field"><label className="tp-label">Name</label><input className="tp-input" placeholder="Conductor full name" value={vForm.conductorName} onChange={e => setVForm(f => ({ ...f, conductorName: e.target.value }))} /></div>
                <div className="tp-field"><label className="tp-label">Phone</label><input className="tp-input mono" placeholder="+91 00000 00000" value={vForm.conductorPhone} onChange={e => setVForm(f => ({ ...f, conductorPhone: e.target.value }))} /></div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0F172A' }}>Active</div>
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>Vehicle is in service and assignable to trips</div>
                </div>
                <button className={`tp-toggle ${vForm.isActive ? 'on' : 'off'}`} onClick={() => setVForm(f => ({ ...f, isActive: !f.isActive }))} />
              </div>
            </div>
            <div className="tp-drawer-footer">
              <button className="tp-btn tp-btn-outline" onClick={() => setVDrawer(false)}>Cancel</button>
              <button className="tp-btn tp-btn-primary" disabled={saving} onClick={saveVehicle}>
                {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Check size={13} /> {vEdit ? 'Save Changes' : 'Add Vehicle'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Route Drawer ─────────────────────────────────────────────────── */}
      {rDrawer && (
        <div className="tp-overlay" onClick={() => setRDrawer(false)}>
          <div className="tp-drawer" onClick={e => e.stopPropagation()}>
            <div className="tp-drawer-head">
              <div>
                <div className="tp-drawer-title">{rEdit ? 'Edit Route' : 'Add Route'}</div>
                <div className="tp-drawer-sub">Routes are independent — created and managed by the school</div>
              </div>
              <button className="tp-drawer-close" onClick={() => setRDrawer(false)}><X size={13} /></button>
            </div>
            <div className="tp-drawer-body">
              {formError && <div className="tp-error"><AlertCircle size={13} />{formError}</div>}

              <div className="tp-field">
                <label className="tp-label">Route Name <span>*</span></label>
                <input className="tp-input" placeholder="e.g. Kazipet Route" value={rForm.routeName} onChange={e => setRForm(f => ({ ...f, routeName: e.target.value }))} />
              </div>

              <div className="tp-field">
                <label className="tp-label">Route Code (optional)</label>
                <input className="tp-input mono" placeholder="e.g. RT-01" value={rForm.routeCode} onChange={e => setRForm(f => ({ ...f, routeCode: e.target.value }))} />
              </div>

              <div className="tp-section-label">Stops</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px auto', gap: '0.5rem' }}>
                <input className="tp-input" placeholder="Stop Name" value={stopName} onChange={e => setStopName(e.target.value)} />
                <input type="number" className="tp-input mono" placeholder="Fee" value={stopFee || ''} onChange={e => setStopFee(Number(e.target.value) || 0)} />
                <button className="tp-btn tp-btn-outline" onClick={addStop}><Plus size={12} /></button>
              </div>
              {rForm.stops.length > 0 && (
                <div className="tp-stop-list">
                  {rForm.stops.map((s, i) => (
                    <div className="tp-stop-pill" key={i}>
                      <span className="tp-stop-pill-order">{s.order + 1}</span>
                      <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{s.name}</span>
                        <span style={{ fontFamily: 'Geist Mono', color: '#16A34A' }}>₹{s.transportFee || 0}</span>
                      </div>
                      <button className="tp-stop-pill-del" onClick={() => removeStop(i)}><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0F172A' }}>Active</div>
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>Route is in use and selectable for trips</div>
                </div>
                <button className={`tp-toggle ${rForm.isActive ? 'on' : 'off'}`} onClick={() => setRForm(f => ({ ...f, isActive: !f.isActive }))} />
              </div>
            </div>
            <div className="tp-drawer-footer">
              <button className="tp-btn tp-btn-outline" onClick={() => setRDrawer(false)}>Cancel</button>
              <button className="tp-btn tp-btn-primary" disabled={saving} onClick={saveRoute}>
                {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Check size={13} /> {rEdit ? 'Save Changes' : 'Add Route'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Trip Drawer ──────────────────────────────────────────────────── */}
      {tDrawer && (
        <div className="tp-overlay" onClick={() => setTDrawer(false)}>
          <div className="tp-drawer" onClick={e => e.stopPropagation()}>
            <div className="tp-drawer-head">
              <div>
                <div className="tp-drawer-title">{tEdit ? 'Edit Trip' : 'Add Trip'}</div>
                <div className="tp-drawer-sub">A trip links one vehicle to one route with timing. A vehicle can have multiple trips.</div>
              </div>
              <button className="tp-drawer-close" onClick={() => setTDrawer(false)}><X size={13} /></button>
            </div>

            <div className="tp-drawer-body">
              {formError && <div className="tp-error"><AlertCircle size={13} />{formError}</div>}

              <div className="tp-field">
                <label className="tp-label">Trip Name <span>*</span></label>
                <input className="tp-input" placeholder="e.g. Morning Trip 1" value={tForm.tripName} onChange={e => setTForm(f => ({ ...f, tripName: e.target.value }))} />
              </div>

              <div className="tp-field">
                <label className="tp-label">Vehicle <span>*</span></label>
                <select className="tp-select" value={tForm.vehicleId} onChange={e => setTForm(f => ({ ...f, vehicleId: e.target.value }))}>
                  <option value="">Select vehicle…</option>
                  {vehicles.filter(v => v.isActive).map(v => (
                    <option key={v.id} value={v.id}>{v.vehicleNo} ({v.type})</option>
                  ))}
                </select>
              </div>

              <div className="tp-field">
                <label className="tp-label">Route <span>*</span></label>
                <select className="tp-select" value={tForm.routeId} onChange={e => setTForm(f => ({ ...f, routeId: e.target.value }))}>
                  <option value="">Select route…</option>
                  {routes.filter(r => r.isActive).map(r => (
                    <option key={r.id} value={r.id}>{r.routeName}{r.routeCode ? ` (${r.routeCode})` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="tp-grid-2">
                <div className="tp-field">
                  <label className="tp-label">Start Time <span>*</span></label>
                  <input type="time" className="tp-input mono" value={tForm.startTime} onChange={e => setTForm(f => ({ ...f, startTime: e.target.value }))} />
                </div>
                <div className="tp-field">
                  <label className="tp-label">End Time <span>*</span></label>
                  <input type="time" className="tp-input mono" value={tForm.endTime} onChange={e => setTForm(f => ({ ...f, endTime: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.25rem' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#0F172A' }}>Active</div>
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8' }}>Trip is running and selectable for student assignment</div>
                </div>
                <button className={`tp-toggle ${tForm.isActive ? 'on' : 'off'}`} onClick={() => setTForm(f => ({ ...f, isActive: !f.isActive }))} />
              </div>
            </div>

            <div className="tp-drawer-footer">
              <button className="tp-btn tp-btn-outline" onClick={() => setTDrawer(false)}>Cancel</button>
              <button className="tp-btn tp-btn-primary" disabled={saving} onClick={saveTrip}>
                {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : <><Check size={13} /> {tEdit ? 'Save Changes' : 'Add Trip'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="tp-modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="tp-modal" onClick={e => e.stopPropagation()}>
            <div className="tp-modal-title">
              Delete this {deleteTarget.kind === 'vehicles' ? 'vehicle' : deleteTarget.kind === 'routes' ? 'route' : 'trip'}?
            </div>
            <div className="tp-modal-body">
              {deleteTarget.kind === 'vehicles' && 'This removes the vehicle record permanently. Trips using this vehicle will no longer resolve a vehicle. Consider marking it inactive instead.'}
              {deleteTarget.kind === 'routes'   && 'This removes the route and its stops permanently. Trips using this route will no longer resolve a route. Consider marking it inactive instead.'}
              {deleteTarget.kind === 'trips'    && 'This removes the trip permanently. Students assigned to this trip will need to be reassigned.'}
            </div>
            <div className="tp-modal-actions">
              <button className="tp-btn tp-btn-outline" style={{ flex: 1 }} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="tp-btn tp-btn-danger" style={{ flex: 2 }} onClick={handleDelete}><Trash2 size={12} /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div style={{ padding: '2.5rem 1.25rem', textAlign: 'center' }}>
      <div style={{ color: '#E2E8F0', marginBottom: '0.65rem', display: 'flex', justifyContent: 'center' }}>{icon}</div>
      <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748B' }}>{title}</p>
      <p style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: '0.25rem' }}>{sub}</p>
    </div>
  );
}