/**
 * --------------------------------------------------------------------
 * File:
 * app/(dashboard)/settings/general/page.tsx
 *
 * Changes from the original:
 * - No direct Firestore/Storage calls — routes through schoolService.
 * - Local SchoolData interface replaced with SchoolProfile from
 *   types/school.ts.
 * - File type/size validation and the read-only field stripping
 *   (plan/status/joined) moved into schoolService, so this page can't
 *   accidentally bypass either rule.
 * - convertToWebP moved to utils/image.ts (shared with any other
 *   feature that needs full-resolution WebP conversion).
 *
 * UX revision:
 * - Logo is either an empty-state dropzone (click or drag-and-drop)
 *   or, once set, a compact preview tile — never both at once. The
 *   persistent "Upload Logo" button is gone; replacing an existing
 *   logo happens via the small "Change logo" link (and a hover
 *   affordance on desktop), so the control surface matches the state
 *   instead of always showing an upload action that doesn't apply.
 * - Academic Year is now read-only here — it's owned by Academic
 *   Settings, not this form, so it's rendered locked with a short
 *   explanation instead of being silently editable-but-ignored.
 * - Loading state uses layout-matched skeletons instead of a spinner,
 *   an unsaved-changes indicator replaces guessing from button state
 *   alone, and the error banner is dismissible.
 * --------------------------------------------------------------------
 */

'use client';

import { useRef, useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { schoolService } from '@/services/school/schoolService';
import { SchoolProfile } from '@/types/school';
import { Skeleton } from '@/components/ui/skeleton';
import {
  School, MapPin, Phone, Mail, User, BookOpen,
  Upload, Check, Loader2, AlertCircle, Camera, Lock, X,
} from 'lucide-react';
import '@/styles/config-general.css';

const EMPTY: SchoolProfile = {
  name: '', email: '', phone: '', address: '',
  city: '', state: '', principalName: '',
  currentAcademicYear: '', logoUrl: '',
  plan: '', status: '', joined: '',
};

const ACCEPTED_LOGO_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/bmp';

export default function GeneralPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId ?? '';

  const [form, setForm]         = useState<SchoolProfile>(EMPTY);
  const [original, setOriginal] = useState<SchoolProfile>(EMPTY);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

  const [uploading, setUploading]           = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging]         = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load school profile ─────────────────────────────────────────────────
  useEffect(() => {
    if (!schoolId) return;
    schoolService.getSchoolProfile(schoolId).then((data) => {
      setForm(data);
      setOriginal(data);
      setLoading(false);
    });
  }, [schoolId]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(original);

  function set(field: keyof SchoolProfile, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setSaved(false);
  }

  // ── Logo upload ─────────────────────────────────────────────────────────
  // Shared by the file input, the empty-state dropzone, and drag-and-drop —
  // one path in, so validation/progress/error handling can't drift apart.
  async function processLogoFile(file: File) {
    if (!schoolId) return;

    setUploading(true);
    setUploadProgress(0);
    setError('');

    try {
      const url = await schoolService.uploadLogo(schoolId, file, setUploadProgress);
      setForm(f => ({ ...f, logoUrl: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset input so the same file can be re-selected if needed
    e.target.value = '';
    if (file) processLogoFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!uploading) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processLogoFile(file);
  }

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!schoolId || !isDirty) return;
    setSaving(true);
    setError('');
    try {
      await schoolService.saveSchoolProfile(schoolId, form);
      setOriginal(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    }
    setSaving(false);
  }

  // ───────────────────────────────────────────────────────────────────────
  return (
    <div className="gen-root">

      {/* ── Header ── */}
      <div className="gen-head">
        <div>
          <div className="gen-head-title">General</div>
          <div className="gen-head-sub">School name, logo, address, and contact information</div>
        </div>

        <div className="gen-head-actions">
          {isDirty && !saving && !saved && (
            <span className="gen-unsaved-tag">
              <span className="gen-unsaved-dot" />
              Unsaved changes
            </span>
          )}
          <button
            className={`gen-save-btn ${saved ? 'saved' : !isDirty || saving ? 'disabled' : 'idle'}`}
            onClick={handleSave}
            disabled={!isDirty || saving || saved}
          >
            {saving ? <Loader2 size={14} className="gen-spin" /> : saved ? <Check size={14} /> : null}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="gen-error">
          <AlertCircle size={15} />
          <span className="gen-error-text">{error}</span>
          <button
            className="gen-error-dismiss"
            onClick={() => setError('')}
            aria-label="Dismiss error"
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="gen-body">
          <div className="gen-card">
            <div className="gen-card-head">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
            <div className="gen-card-body" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-32 rounded-xl" />
              ))}
            </div>
          </div>

          <div className="gen-card">
            <div className="gen-card-head">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-4 w-24 rounded" />
            </div>
            <div className="gen-card-body" style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Skeleton className="h-22 w-22 rounded-2xl" />
              <Skeleton className="h-4 w-28 rounded" />
            </div>
          </div>

          <div className="gen-card">
            <div className="gen-card-head">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-4 w-32 rounded" />
            </div>
            <div className="gen-card-body">
              <Skeleton className="h-11 w-full rounded-lg" />
              <div className="gen-grid-2">
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            </div>
          </div>

          <div className="gen-card">
            <div className="gen-card-head">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-4 w-16 rounded" />
            </div>
            <div className="gen-card-body">
              <div className="gen-grid-2">
                <Skeleton className="h-11 w-full rounded-lg" />
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="gen-body">

          {/* ── Account info (read-only) ── */}
          <div className="gen-card">
            <div className="gen-card-head">
              <div className="gen-card-head-icon"><School size={16} /></div>
              <span className="gen-card-head-label">Account</span>
            </div>
            <div className="gen-card-body">
              <div className="gen-pill-row">
                <div className="gen-pill">
                  <span className="gen-pill-label">Plan</span>
                  <span className="gen-pill-value basic">{form.plan || '—'}</span>
                </div>
                <div className="gen-pill">
                  <span className="gen-pill-label">Status</span>
                  <span className={`gen-pill-value ${form.status === 'Active' ? 'active' : ''}`}>{form.status || '—'}</span>
                </div>
                <div className="gen-pill">
                  <span className="gen-pill-label">Joined</span>
                  <span className="gen-pill-value">{form.joined || '—'}</span>
                </div>
                <div className="gen-pill">
                  <span className="gen-pill-label">Academic Year</span>
                  <span className="gen-pill-value">{form.currentAcademicYear || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Logo ── */}
          <div className="gen-card">
            <div className="gen-card-head">
              <div className="gen-card-head-icon"><Camera size={16} /></div>
              <span className="gen-card-head-label">School Logo</span>
            </div>
            <div className="gen-card-body">
              {/* Hidden file input — shared by the tile, the dropzone, and drag-and-drop */}
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_LOGO_TYPES}
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />

              {form.logoUrl ? (
                <div className="gen-logo-filled-row">
                  <button
                    type="button"
                    className="gen-logo-tile"
                    onClick={() => !uploading && fileRef.current?.click()}
                    disabled={uploading}
                    aria-label="Change school logo"
                  >
                    <img src={form.logoUrl} alt="School logo" />
                    {uploading ? (
                      <div className="gen-logo-tile-mask">
                        <Loader2 size={18} className="gen-spin" />
                        <span>{uploadProgress}%</span>
                      </div>
                    ) : (
                      <div className="gen-logo-tile-overlay">
                        <Camera size={16} />
                      </div>
                    )}
                  </button>

                  <div className="gen-logo-filled-meta">
                    <button
                      type="button"
                      className="gen-logo-change-link"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                    >
                      Change logo
                    </button>
                    <span className="gen-logo-hint">JPG, PNG or WebP · Max 5 MB · Saved as WebP</span>
                    {uploading && (
                      <div className="gen-progress-bar">
                        <div className="gen-progress-fill" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={`gen-logo-dropzone ${isDragging ? 'drag-active' : ''}`}
                  onClick={() => !uploading && fileRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 size={22} className="gen-spin" color="#6366F1" />
                      <span className="gen-logo-dropzone-title">Uploading… {uploadProgress}%</span>
                    </>
                  ) : (
                    <>
                      <div className="gen-logo-dropzone-icon"><Upload size={20} /></div>
                      <span className="gen-logo-dropzone-title">Click or drag to upload your logo</span>
                      <span className="gen-logo-hint">JPG, PNG or WebP · Max 5 MB · Saved as WebP</span>
                    </>
                  )}
                  {uploading && (
                    <div className="gen-progress-bar">
                      <div className="gen-progress-fill" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* ── School info ── */}
          <div className="gen-card">
            <div className="gen-card-head">
              <div className="gen-card-head-icon"><School size={16} /></div>
              <span className="gen-card-head-label">School Information</span>
            </div>
            <div className="gen-card-body">
              <div className="gen-field">
                <label className="gen-label" htmlFor="schoolName">School Name</label>
                <div className="gen-input-wrap">
                  <School size={15} className="gen-input-icon" />
                  <input
                    id="schoolName"
                    className="gen-input with-icon"
                    value={form.name ?? ''}
                    onChange={e => set('name', e.target.value.toUpperCase())}
                    placeholder="School name"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
              </div>
              <div className="gen-grid-2">
                <div className="gen-field">
                  <label className="gen-label" htmlFor="principalName">Principal Name</label>
                  <div className="gen-input-wrap">
                    <User size={15} className="gen-input-icon" />
                    <input
                      id="principalName"
                      className="gen-input with-icon"
                      value={form.principalName}
                      onChange={e => set('principalName', e.target.value)}
                      placeholder="Principal name"
                    />
                  </div>
                </div>

                {/* Read-only: owned by Academic Settings, not this form. */}
                <div className="gen-field">
                  <label className="gen-label" htmlFor="academicYear">Academic Year</label>
                  <div className="gen-input-wrap">
                    <BookOpen size={15} className="gen-input-icon" />
                    <input
                      id="academicYear"
                      className="gen-input with-icon with-lock"
                      value={form.currentAcademicYear}
                      readOnly
                      aria-readonly="true"
                      placeholder="e.g. 2025-26"
                    />
                    <Lock size={13} className="gen-input-lock" />
                  </div>
                  <span className="gen-field-hint">Managed in Academic Settings — can&apos;t be edited here.</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Contact ── */}
          <div className="gen-card">
            <div className="gen-card-head">
              <div className="gen-card-head-icon"><Phone size={16} /></div>
              <span className="gen-card-head-label">Contact</span>
            </div>
            <div className="gen-card-body">
              <div className="gen-grid-2">
                <div className="gen-field">
                  <label className="gen-label" htmlFor="phone">Phone</label>
                  <div className="gen-input-wrap">
                    <Phone size={15} className="gen-input-icon" />
                    <input
                      id="phone"
                      className="gen-input with-icon"
                      value={form.phone}
                      onChange={e => set('phone', e.target.value)}
                      placeholder="Phone number"
                    />
                  </div>
                </div>
                <div className="gen-field">
                  <label className="gen-label" htmlFor="email">Email</label>
                  <div className="gen-input-wrap">
                    <Mail size={15} className="gen-input-icon" />
                    <input
                      id="email"
                      className="gen-input with-icon"
                      value={form.email}
                      onChange={e => set('email', e.target.value)}
                      placeholder="Email address"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Address ── */}
          <div className="gen-card">
            <div className="gen-card-head">
              <div className="gen-card-head-icon"><MapPin size={16} /></div>
              <span className="gen-card-head-label">Address</span>
            </div>
            <div className="gen-card-body">
              <div className="gen-field">
                <label className="gen-label" htmlFor="address">Street Address</label>
                <div className="gen-input-wrap">
                  <MapPin size={15} className="gen-input-icon" />
                  <input
                    id="address"
                    className="gen-input with-icon"
                    value={form.address}
                    onChange={e => set('address', e.target.value)}
                    placeholder="Street address"
                  />
                </div>
              </div>
              <div className="gen-grid-2">
                <div className="gen-field">
                  <label className="gen-label" htmlFor="city">City</label>
                  <input
                    id="city"
                    className="gen-input"
                    value={form.city}
                    onChange={e => set('city', e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div className="gen-field">
                  <label className="gen-label" htmlFor="state">State</label>
                  <input
                    id="state"
                    className="gen-input"
                    value={form.state}
                    onChange={e => set('state', e.target.value)}
                    placeholder="State"
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}