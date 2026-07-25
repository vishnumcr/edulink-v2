'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { admissionService } from '@/services/admission/admissionService';
import { classesService } from '@/services/academic/classesService';
import { routesService } from '@/services/transport/routesService';
import { AdmissionInput, Category, Gender, BloodGroup } from '@/types/admission';
import { Route } from '@/types/transport';
import {
  ChevronRight, ChevronLeft, Check, Loader2, AlertCircle,
  User, Users, MapPin, FileText, GraduationCap, X, Bus
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
// Category/Gender/BloodGroup come from types/admission.ts (shared with the
// Firestore document shape). Everything below is local, FLAT form state —
// deliberately not the same shape as the nested Admission document; see
// buildAdmissionInput() below for the assembly step, same pattern
// settings/fees/page.tsx uses for its own form → document mapping.

interface ClassInfo {
  className: string;
}

interface StudentInfo {
  name         : string;
  dob          : string;
  gender       : Gender;
  bloodGroup   : BloodGroup;
  aadhar       : string;
  apaarId      : string;
  penId        : string;
  category     : Category;
  religion     : string;
  nationality  : string;
  previousSchool: string;
  tcNumber     : string;
  lastClassPassed: string;
}

interface ParentInfo {
  fatherName       : string;
  fatherPhone      : string;
  fatherEmail      : string;
  fatherOccupation : string;
  fatherAadhar     : string;
  motherName       : string;
  motherPhone      : string;
  motherEmail      : string;
  motherOccupation : string;
  motherAadhar     : string;
  annualIncome     : string;
  siblingInSchool  : boolean;
  siblingName      : string;
  siblingClass     : string;
}

interface AddressInfo {
  currentLine1  : string;
  currentLine2  : string;
  currentCity   : string;
  currentState  : string;
  currentPin    : string;
  sameAsCurrent : boolean;
  permanentLine1: string;
  permanentLine2: string;
  permanentCity : string;
  permanentState: string;
  permanentPin  : string;
}

interface AdmissionInfo {
  applyingForClass  : string;
  sectionPreference : string;
  rollNo            : string;
  admissionDate     : string;
  remarks           : string;
  transportRequired : boolean;
  transportRouteId  : string;
  transportStopName : string;
  // Documents checklist
  docBirthCert    : boolean;
  docTC           : boolean;
  docAadhar       : boolean;
  docPhoto        : boolean;
  docCasteCert    : boolean;
  docIncomeCert   : boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────
const SECTIONS = ['A', 'B', 'C', 'D', 'E'];
const BLOOD_GROUPS: BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', ''];
const CATEGORIES: Category[] = ['General', 'OBC', 'SC', 'ST', 'EWS'];
const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];

const EMPTY_STUDENT: StudentInfo = {
  name: '', dob: '', gender: 'Male', bloodGroup: '',
  aadhar: '', apaarId: '', penId: '', category: 'General', religion: '',
  nationality: 'Indian', previousSchool: '', tcNumber: '', lastClassPassed: '',
};
const EMPTY_PARENT: ParentInfo = {
  fatherName: '', fatherPhone: '', fatherEmail: '', fatherOccupation: '', fatherAadhar: '',
  motherName: '', motherPhone: '', motherEmail: '', motherOccupation: '', motherAadhar: '',
  annualIncome: '', siblingInSchool: false, siblingName: '', siblingClass: '',
};
const EMPTY_ADDRESS: AddressInfo = {
  currentLine1: '', currentLine2: '', currentCity: '', currentState: '', currentPin: '',
  sameAsCurrent: false,
  permanentLine1: '', permanentLine2: '', permanentCity: '', permanentState: '', permanentPin: '',
};
const EMPTY_ADMISSION: AdmissionInfo = {
  applyingForClass: '', sectionPreference: '', rollNo: '',
  admissionDate: new Date().toISOString().split('T')[0],
  remarks: '',
  transportRequired: false, transportRouteId: '', transportStopName: '',
  docBirthCert: false, docTC: false, docAadhar: false,
  docPhoto: false, docCasteCert: false, docIncomeCert: false,
};

const STEPS = [
  { id: 1, label: 'Student',   icon: User        },
  { id: 2, label: 'Parents',   icon: Users       },
  { id: 3, label: 'Address',   icon: MapPin      },
  { id: 4, label: 'Admission', icon: GraduationCap },
  { id: 5, label: 'Review',    icon: FileText    },
];

// ── Helpers ────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#6366F1','#8B5CF6','#EC4899','#14B8A6','#F59E0B','#10B981','#3B82F6','#EF4444'];
function randomColor() { return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]; }
function initials(name: string) {
  return name.trim().split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AdmissionPage() {
  const { profile } = useAuth();
  const schoolId = profile?.schoolId;

  const [step,      setStep]      = useState(1);
  const [student,   setStudent]   = useState<StudentInfo>(EMPTY_STUDENT);
  const [parent,    setParent]    = useState<ParentInfo>(EMPTY_PARENT);
  const [address,   setAddress]   = useState<AddressInfo>(EMPTY_ADDRESS);
  const [admission, setAdmission] = useState<AdmissionInfo>(EMPTY_ADMISSION);
  const [error,     setError]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [success,   setSuccess]   = useState<string | null>(null);

  // ── Load classes ─────────────────────────────────────────────────────
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  useEffect(() => {
    if (!schoolId) return;
    const unsub = classesService.subscribeToClassLabels(schoolId, (labels) => {
      setClasses(labels.map((className) => ({ className })));
    });
    return () => unsub();
  }, [schoolId]);

  // ── Load active transport routes ────────────────────────────────────────
  const [routes, setRoutes] = useState<Route[]>([]);
  useEffect(() => {
    if (!schoolId) return;
    const unsub = routesService.subscribeToRoutes(schoolId, (list) => {
      setRoutes(list.filter(r => r.isActive));
    });
    return () => unsub();
  }, [schoolId]);

  const selectedRoute = routes.find(r => r.id === admission.transportRouteId) ?? null;
  const selectedStop = selectedRoute?.stops.find(s => s.name === admission.transportStopName) ?? null;

  // ── Address sync ──────────────────────────────────────────────────────
  function handleSameAsCurrent(checked: boolean) {
    if (checked) {
      setAddress(a => ({
        ...a,
        sameAsCurrent: true,
        permanentLine1: a.currentLine1,
        permanentLine2: a.currentLine2,
        permanentCity:  a.currentCity,
        permanentState: a.currentState,
        permanentPin:   a.currentPin,
      }));
    } else {
      setAddress(a => ({ ...a, sameAsCurrent: false }));
    }
  }

  // ── Validation ────────────────────────────────────────────────────────
  function validate(): string {
    if (step === 1) {
      if (!student.name.trim())    return 'Student name is required.';
      if (!student.dob)            return 'Date of birth is required.';
      if (!student.category)       return 'Category is required.';
    }
    if (step === 2) {
      if (!parent.fatherName.trim() && !parent.motherName.trim())
        return 'At least one parent name is required.';
      if (!parent.fatherPhone && !parent.motherPhone)
        return 'At least one parent phone number is required.';
    }
    if (step === 3) {
      if (!address.currentLine1.trim()) return 'Current address is required.';
      if (!address.currentCity.trim())  return 'City is required.';
      if (!address.currentPin.trim())   return 'PIN code is required.';
    }
    if (step === 4) {
      if (!admission.applyingForClass)  return 'Class applied for is required.';
      if (!admission.admissionDate)     return 'Admission date is required.';
    }
    return '';
  }

  function handleNext() {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function handleBack() {
    setError('');
    setStep(s => s - 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Submit ────────────────────────────────────────────────────────────
  // Writes ONLY the admissions document (status starts "pending"). A
  // Student is no longer created here — that now happens once staff
  // approve the application and the admission fee is paid, via a
  // Cloud Function (collects payment + creates Student + first
  // invoice atomically). See the admission review page.
  async function handleSubmit() {
    if (!schoolId) return;
    setSaving(true); setError('');
    try {
      const input: AdmissionInput = {
        student: {
          name:            student.name,
          dob:             student.dob,
          gender:          student.gender,
          bloodGroup:      student.bloodGroup,
          aadhar:          student.aadhar,
          apaarId:         student.apaarId,
          penId:           student.penId,
          category:        student.category,
          religion:        student.religion,
          nationality:     student.nationality,
          previousSchool:  student.previousSchool,
          tcNumber:        student.tcNumber,
          lastClassPassed: student.lastClassPassed,
        },
        parent: {
          father: {
            name:       parent.fatherName,
            phone:      parent.fatherPhone,
            email:      parent.fatherEmail,
            occupation: parent.fatherOccupation,
            aadhar:     parent.fatherAadhar,
          },
          mother: {
            name:       parent.motherName,
            phone:      parent.motherPhone,
            email:      parent.motherEmail,
            occupation: parent.motherOccupation,
            aadhar:     parent.motherAadhar,
          },
          annualIncome:    parent.annualIncome,
          siblingInSchool: parent.siblingInSchool,
          siblingName:     parent.siblingName,
          siblingClass:    parent.siblingClass,
        },
        address: {
          current: {
            line1: address.currentLine1,
            line2: address.currentLine2,
            city:  address.currentCity,
            state: address.currentState,
            pin:   address.currentPin,
          },
          permanent: address.sameAsCurrent
            ? {
                line1: address.currentLine1, line2: address.currentLine2,
                city:  address.currentCity,  state: address.currentState,
                pin:   address.currentPin,
              }
            : {
                line1: address.permanentLine1, line2: address.permanentLine2,
                city:  address.permanentCity,  state: address.permanentState,
                pin:   address.permanentPin,
              },
        },
        admission: {
          applyingForClass:  admission.applyingForClass,
          sectionPreference: admission.sectionPreference,
          rollNo:            admission.rollNo,
          admissionDate:     admission.admissionDate,
          remarks:           admission.remarks,
          transportRequired: admission.transportRequired,
          transportRouteId:  admission.transportRequired ? admission.transportRouteId : '',
          transportStopName: admission.transportRequired ? admission.transportStopName : '',
          documents: {
            birthCertificate: admission.docBirthCert,
            tc:               admission.docTC,
            aadhar:           admission.docAadhar,
            photo:            admission.docPhoto,
            casteCertificate: admission.docCasteCert,
            incomeCertificate:admission.docIncomeCert,
          },
        },
        avatarColor: randomColor(),
      };

      const result = await admissionService.submitAdmission(schoolId, input);
      if (!result.ok) { setError(result.error); return; }

      setSuccess(result.admissionId);
    } catch (e) {
      console.error(e);
      setError('Failed to submit admission. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────
  function handleReset() {
    setStep(1);
    setStudent(EMPTY_STUDENT);
    setParent(EMPTY_PARENT);
    setAddress(EMPTY_ADDRESS);
    setAdmission(EMPTY_ADMISSION);
    setError('');
    setSuccess(null);
  }

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');

        .ap * { box-sizing: border-box; margin: 0; padding: 0; }
        .ap {
          font-family: 'Geist', sans-serif;
          background: #F8FAFC;
          min-height: 100%;
          color: #0F172A;
          display: flex;
          flex-direction: column;
        }

        /* ── Topbar ─────────────────────────────────────────────────── */
        .ap-topbar {
          background: #fff;
          border-bottom: 1px solid #E2E8F0;
          padding: 1rem 1.75rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky; top: -25px; z-index: 10;
        }
        .ap-topbar-left h1 {
          font-family: 'Instrument Serif', serif;
          font-size: 1.3rem; font-weight: 400; color: #0F172A; line-height: 1;
        }
        .ap-topbar-left p { font-size: 0.72rem; color: #94A3B8; margin-top: 2px; }

        /* ── Stepper ─────────────────────────────────────────────────── */
        .ap-stepper {
          background: #fff;
          border-bottom: 1px solid #E2E8F0;
          padding: 0 1.75rem;
          display: flex;
          align-items: stretch;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .ap-stepper::-webkit-scrollbar { display: none; }

        .ap-step {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          padding: 0.85rem 1.25rem 0.85rem 0;
          font-size: 0.75rem;
          font-weight: 600;
          color: #CBD5E1;
          white-space: nowrap;
          border-bottom: 2px solid transparent;
          transition: all 0.15s;
          cursor: default;
          user-select: none;
        }
        .ap-step.done   { color: #64748B; border-bottom-color: #E2E8F0; }
        .ap-step.active { color: #0F172A; border-bottom-color: #0F172A; }

        .ap-step-dot {
          width: 24px; height: 24px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 0.65rem; font-weight: 700;
          background: #F1F5F9;
          color: #94A3B8;
          flex-shrink: 0;
          transition: all 0.15s;
        }
        .ap-step.done   .ap-step-dot { background: #F0FDF4; color: #16A34A; }
        .ap-step.active .ap-step-dot { background: #0F172A; color: #fff; }

        .ap-step-arrow { color: #E2E8F0; margin-right: 0.5rem; flex-shrink: 0; }
        .ap-step:first-child { padding-left: 0; }

        /* ── Body ───────────────────────────────────────────────────── */
        .ap-body {
          flex: 1;
          max-width: 760px;
          width: 100%;
          margin: 0 auto;
          padding: 1.75rem 1.75rem 6rem;
        }

        /* ── Section card ───────────────────────────────────────────── */
        .ap-card {
          background: #fff;
          border: 1px solid #E2E8F0;
          border-radius: 14px;
          overflow: hidden;
          margin-bottom: 1.25rem;
        }
        .ap-card-head {
          padding: 0.9rem 1.25rem;
          border-bottom: 1px solid #F1F5F9;
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .ap-card-head-icon {
          width: 30px; height: 30px;
          border-radius: 8px;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
          display: flex; align-items: center; justify-content: center;
          color: #64748B;
          flex-shrink: 0;
        }
        .ap-card-head-text h3 {
          font-size: 0.82rem; font-weight: 700; color: #0F172A;
        }
        .ap-card-head-text p {
          font-size: 0.68rem; color: #94A3B8; margin-top: 1px;
        }
        .ap-card-body { padding: 1.25rem; }

        /* ── Form fields ────────────────────────────────────────────── */
        .ap-field { margin-bottom: 0.85rem; }
        .ap-label {
          display: block;
          font-size: 0.62rem; font-weight: 700;
          letter-spacing: 0.09em; text-transform: uppercase;
          color: #64748B; margin-bottom: 0.4rem;
        }
        .ap-label span { color: #EF4444; margin-left: 2px; }
        .ap-input, .ap-select {
          width: 100%; height: 36px;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
          border-radius: 7px;
          padding: 0 0.75rem;
          font-family: 'Geist', sans-serif;
          font-size: 0.83rem; color: #0F172A;
          outline: none; transition: border-color 0.12s;
        }
        .ap-input:focus, .ap-select:focus { border-color: #94A3B8; background: #fff; }
        .ap-input::placeholder { color: #CBD5E1; }
        .ap-input.mono { font-family: 'Geist Mono', monospace; }

        .ap-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .ap-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }

        .ap-divider {
          font-size: 0.6rem; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: #CBD5E1;
          margin: 1rem 0 0.75rem;
          display: flex; align-items: center; gap: 0.5rem;
        }
        .ap-divider::after { content: ''; flex: 1; height: 1px; background: #F1F5F9; }

        /* Checkbox */
        .ap-check-row {
          display: flex; align-items: center; gap: 0.6rem;
          padding: 0.55rem 0;
          cursor: pointer;
        }
        .ap-check-row input[type="checkbox"] {
          width: 15px; height: 15px;
          accent-color: #0F172A; cursor: pointer;
        }
        .ap-check-label {
          font-size: 0.78rem; color: #334155; font-weight: 500;
          user-select: none;
        }
        .ap-check-sub { font-size: 0.68rem; color: #94A3B8; margin-top: 1px; }

        /* Doc checklist */
        .ap-doc-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
        }
        .ap-doc-item {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.55rem 0.75rem;
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.12s;
          user-select: none;
        }
        .ap-doc-item:hover { border-color: #CBD5E1; background: #F8FAFC; }
        .ap-doc-item.checked { border-color: #BBF7D0; background: #F0FDF4; }
        .ap-doc-item input[type="checkbox"] {
          width: 14px; height: 14px; accent-color: #16A34A; cursor: pointer;
        }
        .ap-doc-item-label {
          font-size: 0.75rem; font-weight: 500; color: #334155;
        }
        .ap-doc-item.checked .ap-doc-item-label { color: #16A34A; }

        /* ── Error ──────────────────────────────────────────────────── */
        .ap-error {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.65rem 0.85rem;
          border-radius: 8px;
          background: #FEF2F2; border: 1px solid #FECACA;
          color: #DC2626; font-size: 0.78rem; font-weight: 500;
          margin-bottom: 1rem;
        }

        /* ── Footer nav ─────────────────────────────────────────────── */
        .ap-footer {
          position: fixed; bottom: 0; left: 0; right: 0;
          background: rgba(255,255,255,0.95);
          backdrop-filter: blur(8px);
          border-top: 1px solid #E2E8F0;
          padding: 0.9rem 1.75rem;
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; z-index: 20;
        }
        .ap-footer-info { font-size: 0.72rem; color: #94A3B8; }
        .ap-footer-info strong { color: #0F172A; font-weight: 600; }
        .ap-footer-actions { display: flex; gap: 0.6rem; }

        .ap-btn {
          height: 36px; padding: 0 1rem;
          border-radius: 8px;
          font-family: 'Geist', sans-serif;
          font-size: 0.8rem; font-weight: 600;
          cursor: pointer; border: none;
          display: inline-flex; align-items: center; gap: 0.4rem;
          transition: all 0.12s; white-space: nowrap;
        }
        .ap-btn-outline {
          background: #fff; border: 1px solid #E2E8F0 !important; color: #475569;
        }
        .ap-btn-outline:hover { border-color: #CBD5E1 !important; color: #0F172A; }
        .ap-btn-primary {
          background: #0F172A; color: #fff;
          box-shadow: 0 1px 3px rgba(15,23,42,0.15);
          padding: 0 1.4rem;
        }
        .ap-btn-primary:hover:not(:disabled) { background: #1E293B; }
        .ap-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Review panel ───────────────────────────────────────────── */
        .ap-review-avatar {
          width: 56px; height: 56px; border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Instrument Serif', serif;
          font-size: 1.3rem; color: #fff;
          flex-shrink: 0;
        }
        .ap-review-hero {
          display: flex; align-items: center; gap: 1rem;
          padding: 1.25rem;
          border-bottom: 1px solid #F1F5F9;
        }
        .ap-review-hero-name {
          font-family: 'Instrument Serif', serif;
          font-size: 1.15rem; color: #0F172A; line-height: 1.2;
        }
        .ap-review-hero-sub {
          font-size: 0.72rem; color: #94A3B8; margin-top: 3px;
          font-family: 'Geist Mono', monospace;
        }
        .ap-review-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0; 
        }
        .ap-review-item {
          padding: 0.65rem 1.25rem;
          border-bottom: 1px solid #F8FAFC;
          border-right: 1px solid #F8FAFC;
        }
        .ap-review-item:nth-child(even) { border-right: none; }
        .ap-review-label {
          font-size: 0.6rem; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: #CBD5E1; margin-bottom: 2px;
        }
        .ap-review-val {
          font-size: 0.8rem; color: #0F172A; font-weight: 500;
        }
        .ap-review-val.mono { font-family: 'Geist Mono', monospace; font-size: 0.75rem; }
        .ap-review-section-label {
          font-size: 0.6rem; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: #94A3B8; padding: 0.75rem 1.25rem 0.4rem;
          background: #F8FAFC; border-bottom: 1px solid #F1F5F9;
        }

        /* Badge */
        .ap-badge {
          display: inline-flex; align-items: center;
          padding: 0.18rem 0.55rem; border-radius: 99px;
          font-size: 0.65rem; font-weight: 700; border: 1px solid;
        }

        /* ── Success ────────────────────────────────────────────────── */
        .ap-success {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: 3rem 1.75rem; text-align: center; gap: 0.75rem;
        }
        .ap-success-icon {
          width: 60px; height: 60px; border-radius: 16px;
          background: #F0FDF4; border: 1.5px solid #BBF7D0;
          display: flex; align-items: center; justify-content: center;
          color: #16A34A; margin-bottom: 0.5rem;
        }
        .ap-success h2 {
          font-family: 'Instrument Serif', serif;
          font-size: 1.4rem; font-weight: 400; color: #0F172A;
        }
        .ap-success p { font-size: 0.8rem; color: #64748B; max-width: 360px; line-height: 1.6; }
        .ap-success-id {
          font-family: 'Geist Mono', monospace;
          font-size: 0.75rem; color: #94A3B8;
          background: #F8FAFC; border: 1px solid #E2E8F0;
          padding: 0.4rem 0.85rem; border-radius: 6px;
        }

        @media (max-width: 600px) {
          .ap-grid-2, .ap-grid-3 { grid-template-columns: 1fr; }
          .ap-review-grid { grid-template-columns: 1fr; }
          .ap-review-item { border-right: none; }
          .ap-doc-grid { grid-template-columns: 1fr; }
          .ap-body { padding: 1rem 1rem 6rem; }
        }
      `}</style>

      <div className="ap">

        {/* ── Topbar ──────────────────────────────────────────────────── */}
        <div className="ap-topbar">
          <div className="ap-topbar-left">
            <h1>New Admission</h1>
            <p>Complete all steps to submit an application · {schoolId}</p>
          </div>
          <a href="/admission/review">
            <button className="ap-btn ap-btn-outline">View Applications</button>
          </a>
        </div>

        {/* ── Stepper ─────────────────────────────────────────────────── */}
        {!success && (
          <div className="ap-stepper">
            {STEPS.map((s, idx) => {
              const state = step === s.id ? 'active' : step > s.id ? 'done' : '';
              const Icon = s.icon;
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
                  {idx > 0 && (
                    <ChevronRight size={14} className="ap-step-arrow" />
                  )}
                  <div className={`ap-step ${state}`}>
                    <div className="ap-step-dot">
                      {step > s.id ? <Check size={11} /> : <Icon size={11} />}
                    </div>
                    {s.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Success ─────────────────────────────────────────────────── */}
        {success ? (
          <div className="ap-success">
            <div className="ap-success-icon"><Check size={26} /></div>
            <h2>Application Submitted</h2>
            <p>The application is now pending review by the admissions team. Once approved and the admission fee is collected, the student record will be created automatically.</p>
            <div className="ap-success-id">Admission ID: {success}</div>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem' }}>
              <button className="ap-btn ap-btn-outline" onClick={handleReset}>
                New Admission
              </button>
              <a href="/admission/review">
                <button className="ap-btn ap-btn-primary">
                  View Applications
                </button>
              </a>
            </div>
          </div>
        ) : (

          <div className="ap-body">
            {error && (
              <div className="ap-error"><AlertCircle size={14} />{error}</div>
            )}

            {/* ── Step 1: Student Info ─────────────────────────────── */}
            {step === 1 && (
              <>
                <div className="ap-card">
                  <div className="ap-card-head">
                    <div className="ap-card-head-icon"><User size={14} /></div>
                    <div className="ap-card-head-text">
                      <h3>Student Information</h3>
                      <p>Basic personal details of the student</p>
                    </div>
                  </div>
                  <div className="ap-card-body">
                    <div className="ap-field">
                      <label className="ap-label">Full Name <span>*</span></label>
                      <input className="ap-input" placeholder="e.g. Arjun Kumar Singh"
                        value={student.name}
                        onChange={e => setStudent({ ...student, name: e.target.value })} />
                    </div>
                    <div className="ap-grid-3">
                      <div className="ap-field">
                        <label className="ap-label">Gender</label>
                        <select className="ap-select" value={student.gender}
                          onChange={e => setStudent({ ...student, gender: e.target.value as Gender })}>
                          <option>Male</option><option>Female</option><option>Other</option>
                        </select>
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Date of Birth <span>*</span></label>
                        <input type="date" className="ap-input"
                          value={student.dob}
                          onChange={e => setStudent({ ...student, dob: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Blood Group</label>
                        <select className="ap-select" value={student.bloodGroup}
                          onChange={e => setStudent({ ...student, bloodGroup: e.target.value as BloodGroup })}>
                          <option value="">—</option>
                          {BLOOD_GROUPS.filter(Boolean).map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="ap-grid-2">
                      <div className="ap-field">
                        <label className="ap-label">Category <span>*</span></label>
                        <select className="ap-select" value={student.category}
                          onChange={e => setStudent({ ...student, category: e.target.value as Category })}>
                          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Religion</label>
                        <input className="ap-input" placeholder="e.g. Hindu"
                          value={student.religion}
                          onChange={e => setStudent({ ...student, religion: e.target.value })} />
                      </div>
                    </div>
                    <div className="ap-grid-2">
                      <div className="ap-field">
                        <label className="ap-label">Nationality</label>
                        <input className="ap-input" value={student.nationality}
                          onChange={e => setStudent({ ...student, nationality: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Aadhar Number</label>
                        <input className="ap-input mono" placeholder="0000 0000 0000"
                          maxLength={14}
                          value={student.aadhar}
                          onChange={e => setStudent({ ...student, aadhar: e.target.value })} />
                      </div>
                    </div>
                    <div className="ap-grid-2">
                      <div className="ap-field">
                        <label className="ap-label">APAAR ID</label>
                        <input className="ap-input mono" placeholder="0000 0000 0000"
                          maxLength={12}
                          value={student.apaarId}
                          onChange={e => setStudent({ ...student, apaarId: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">PEN (State Enrollment No.)</label>
                        <input className="ap-input mono"
                          value={student.penId}
                          onChange={e => setStudent({ ...student, penId: e.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="ap-card">
                  <div className="ap-card-head">
                    <div className="ap-card-head-icon"><GraduationCap size={14} /></div>
                    <div className="ap-card-head-text">
                      <h3>Previous Education</h3>
                      <p>Details of last school attended</p>
                    </div>
                  </div>
                  <div className="ap-card-body">
                    <div className="ap-field">
                      <label className="ap-label">Previous School Name</label>
                      <input className="ap-input" placeholder="e.g. Delhi Public School, Rohini"
                        value={student.previousSchool}
                        onChange={e => setStudent({ ...student, previousSchool: e.target.value })} />
                    </div>
                    <div className="ap-grid-2">
                      <div className="ap-field">
                        <label className="ap-label">TC Number</label>
                        <input className="ap-input mono" placeholder="Transfer certificate no."
                          value={student.tcNumber}
                          onChange={e => setStudent({ ...student, tcNumber: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Last Class Passed</label>
                        <select className="ap-select" value={student.lastClassPassed}
                          onChange={e => setStudent({ ...student, lastClassPassed: e.target.value })}>
                          <option value="">—</option>
                          {classes.map(c => <option key={c.className} value={c.className}>Class {c.className}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Step 2: Parent Info ──────────────────────────────── */}
            {step === 2 && (
              <div className="ap-card">
                <div className="ap-card-head">
                  <div className="ap-card-head-icon"><Users size={14} /></div>
                  <div className="ap-card-head-text">
                    <h3>Parent / Guardian Details</h3>
                    <p>At least one parent's name and phone are required</p>
                  </div>
                </div>
                <div className="ap-card-body">
                  <div className="ap-divider">Father</div>
                  <div className="ap-grid-2">
                    <div className="ap-field">
                      <label className="ap-label">Father's Name</label>
                      <input className="ap-input" placeholder="Full name"
                        value={parent.fatherName}
                        onChange={e => setParent({ ...parent, fatherName: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Phone</label>
                      <input className="ap-input mono" placeholder="+91 00000 00000"
                        value={parent.fatherPhone}
                        onChange={e => setParent({ ...parent, fatherPhone: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Email</label>
                      <input type="email" className="ap-input" placeholder="father@email.com"
                        value={parent.fatherEmail}
                        onChange={e => setParent({ ...parent, fatherEmail: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Occupation</label>
                      <input className="ap-input" placeholder="e.g. Engineer"
                        value={parent.fatherOccupation}
                        onChange={e => setParent({ ...parent, fatherOccupation: e.target.value })} />
                    </div>
                    <div className="ap-field" style={{ gridColumn: 'span 2' }}>
                      <label className="ap-label">Aadhar Number</label>
                      <input className="ap-input mono" placeholder="0000 0000 0000" maxLength={14}
                        value={parent.fatherAadhar}
                        onChange={e => setParent({ ...parent, fatherAadhar: e.target.value })} />
                    </div>
                  </div>

                  <div className="ap-divider">Mother</div>
                  <div className="ap-grid-2">
                    <div className="ap-field">
                      <label className="ap-label">Mother's Name</label>
                      <input className="ap-input" placeholder="Full name"
                        value={parent.motherName}
                        onChange={e => setParent({ ...parent, motherName: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Phone</label>
                      <input className="ap-input mono" placeholder="+91 00000 00000"
                        value={parent.motherPhone}
                        onChange={e => setParent({ ...parent, motherPhone: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Email</label>
                      <input type="email" className="ap-input" placeholder="mother@email.com"
                        value={parent.motherEmail}
                        onChange={e => setParent({ ...parent, motherEmail: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Occupation</label>
                      <input className="ap-input" placeholder="e.g. Teacher"
                        value={parent.motherOccupation}
                        onChange={e => setParent({ ...parent, motherOccupation: e.target.value })} />
                    </div>
                    <div className="ap-field" style={{ gridColumn: 'span 2' }}>
                      <label className="ap-label">Aadhar Number</label>
                      <input className="ap-input mono" placeholder="0000 0000 0000" maxLength={14}
                        value={parent.motherAadhar}
                        onChange={e => setParent({ ...parent, motherAadhar: e.target.value })} />
                    </div>
                  </div>

                  <div className="ap-divider">Additional</div>
                  <div className="ap-field">
                    <label className="ap-label">Annual Family Income</label>
                    <input className="ap-input mono" placeholder="e.g. 600000"
                      value={parent.annualIncome}
                      onChange={e => setParent({ ...parent, annualIncome: e.target.value })} />
                  </div>

                  <label className="ap-check-row">
                    <input type="checkbox"
                      checked={parent.siblingInSchool}
                      onChange={e => setParent({ ...parent, siblingInSchool: e.target.checked })} />
                    <div>
                      <div className="ap-check-label">Sibling already enrolled in this school</div>
                    </div>
                  </label>
                  {parent.siblingInSchool && (
                    <div className="ap-grid-2" style={{ marginTop: '0.5rem' }}>
                      <div className="ap-field">
                        <label className="ap-label">Sibling Name</label>
                        <input className="ap-input" placeholder="Sibling's full name"
                          value={parent.siblingName}
                          onChange={e => setParent({ ...parent, siblingName: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Sibling Class</label>
                        <select className="ap-select" value={parent.siblingClass}
                          onChange={e => setParent({ ...parent, siblingClass: e.target.value })}>
                          <option value="">—</option>
                          {classes.map(c => <option key={c.className} value={c.className}>Class {c.className}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 3: Address ──────────────────────────────────── */}
            {step === 3 && (
              <div className="ap-card">
                <div className="ap-card-head">
                  <div className="ap-card-head-icon"><MapPin size={14} /></div>
                  <div className="ap-card-head-text">
                    <h3>Address Details</h3>
                    <p>Current and permanent residential address</p>
                  </div>
                </div>
                <div className="ap-card-body">
                  <div className="ap-divider">Current Address</div>
                  <div className="ap-field">
                    <label className="ap-label">Line 1 <span>*</span></label>
                    <input className="ap-input" placeholder="House / Flat no., Street name"
                      value={address.currentLine1}
                      onChange={e => setAddress({ ...address, currentLine1: e.target.value })} />
                  </div>
                  <div className="ap-field">
                    <label className="ap-label">Line 2</label>
                    <input className="ap-input" placeholder="Locality, Landmark"
                      value={address.currentLine2}
                      onChange={e => setAddress({ ...address, currentLine2: e.target.value })} />
                  </div>
                  <div className="ap-grid-3">
                    <div className="ap-field">
                      <label className="ap-label">City <span>*</span></label>
                      <input className="ap-input" placeholder="City"
                        value={address.currentCity}
                        onChange={e => setAddress({ ...address, currentCity: e.target.value })} />
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">State</label>
                      <select className="ap-select" value={address.currentState}
                        onChange={e => setAddress({ ...address, currentState: e.target.value })}>
                        <option value="">— State —</option>
                        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">PIN Code <span>*</span></label>
                      <input className="ap-input mono" placeholder="000000" maxLength={6}
                        value={address.currentPin}
                        onChange={e => setAddress({ ...address, currentPin: e.target.value })} />
                    </div>
                  </div>

                  <div className="ap-divider">Permanent Address</div>
                  <label className="ap-check-row" style={{ marginBottom: '0.75rem' }}>
                    <input type="checkbox"
                      checked={address.sameAsCurrent}
                      onChange={e => handleSameAsCurrent(e.target.checked)} />
                    <div className="ap-check-label">Same as current address</div>
                  </label>

                  {!address.sameAsCurrent && (
                    <>
                      <div className="ap-field">
                        <label className="ap-label">Line 1</label>
                        <input className="ap-input" placeholder="House / Flat no., Street name"
                          value={address.permanentLine1}
                          onChange={e => setAddress({ ...address, permanentLine1: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Line 2</label>
                        <input className="ap-input" placeholder="Locality, Landmark"
                          value={address.permanentLine2}
                          onChange={e => setAddress({ ...address, permanentLine2: e.target.value })} />
                      </div>
                      <div className="ap-grid-3">
                        <div className="ap-field">
                          <label className="ap-label">City</label>
                          <input className="ap-input" placeholder="City"
                            value={address.permanentCity}
                            onChange={e => setAddress({ ...address, permanentCity: e.target.value })} />
                        </div>
                        <div className="ap-field">
                          <label className="ap-label">State</label>
                          <select className="ap-select" value={address.permanentState}
                            onChange={e => setAddress({ ...address, permanentState: e.target.value })}>
                            <option value="">— State —</option>
                            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="ap-field">
                          <label className="ap-label">PIN Code</label>
                          <input className="ap-input mono" placeholder="000000" maxLength={6}
                            value={address.permanentPin}
                            onChange={e => setAddress({ ...address, permanentPin: e.target.value })} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 4: Admission Details ────────────────────────── */}
            {step === 4 && (
              <>
                <div className="ap-card">
                  <div className="ap-card-head">
                    <div className="ap-card-head-icon"><GraduationCap size={14} /></div>
                    <div className="ap-card-head-text">
                      <h3>Admission Details</h3>
                      <p>Class, section, and enrollment info</p>
                    </div>
                  </div>
                  <div className="ap-card-body">
                    <div className="ap-grid-3">
                      <div className="ap-field">
                        <label className="ap-label">Applying for Class <span>*</span></label>
                        <select className="ap-select" value={admission.applyingForClass}
                          onChange={e => setAdmission({ ...admission, applyingForClass: e.target.value })}>
                          <option value="">—</option>
                          {classes.map(c => <option key={c.className} value={c.className}>Class {c.className}</option>)}
                        </select>
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Section Preference</label>
                        <select className="ap-select" value={admission.sectionPreference}
                          onChange={e => setAdmission({ ...admission, sectionPreference: e.target.value })}>
                          <option value="">No preference</option>
                          {SECTIONS.map(s => <option key={s} value={s}>Section {s}</option>)}
                        </select>
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Roll No (if assigned)</label>
                        <input className="ap-input mono" placeholder="e.g. 001"
                          value={admission.rollNo}
                          onChange={e => setAdmission({ ...admission, rollNo: e.target.value })} />
                      </div>
                    </div>
                    <div className="ap-grid-2">
                      <div className="ap-field">
                        <label className="ap-label">Admission Date <span>*</span></label>
                        <input type="date" className="ap-input"
                          value={admission.admissionDate}
                          onChange={e => setAdmission({ ...admission, admissionDate: e.target.value })} />
                      </div>
                      <div className="ap-field">
                        <label className="ap-label">Admission Number</label>
                        <div className="ap-input mono" style={{ display: 'flex', alignItems: 'center', color: '#94A3B8', background: '#F8FAFC' }}>
                          Assigned automatically once approved and enrolled
                        </div>
                      </div>
                    </div>
                    <div className="ap-field">
                      <label className="ap-label">Remarks</label>
                      <input className="ap-input" placeholder="Any notes for the admission office"
                        value={admission.remarks}
                        onChange={e => setAdmission({ ...admission, remarks: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="ap-card">
                  <div className="ap-card-head">
                    <div className="ap-card-head-icon"><Bus size={14} /></div>
                    <div className="ap-card-head-text">
                      <h3>School Transport</h3>
                      <p>Optional — adds a recurring transport charge to the student's fee, billed alongside tuition</p>
                    </div>
                  </div>
                  <div className="ap-card-body">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: admission.transportRequired ? '0.9rem' : 0 }}>
                      <input
                        type="checkbox"
                        checked={admission.transportRequired}
                        onChange={e => setAdmission({
                          ...admission,
                          transportRequired: e.target.checked,
                          // Clear any previous selection when turning it off, so a
                          // stale route/stop can never be submitted alongside "not required".
                          transportRouteId: e.target.checked ? admission.transportRouteId : '',
                          transportStopName: e.target.checked ? admission.transportStopName : '',
                        })}
                      />
                      <span className="ap-label" style={{ marginBottom: 0 }}>This student needs school transport</span>
                    </label>

                    {admission.transportRequired && (
                      routes.length === 0 ? (
                        <div className="ap-error">
                          <AlertCircle size={14} />
                          No active transport routes are configured yet — add one in Settings → Transport first.
                        </div>
                      ) : (
                        <div className="ap-grid-2">
                          <div className="ap-field">
                            <label className="ap-label">Route <span>*</span></label>
                            <select className="ap-select" value={admission.transportRouteId}
                              onChange={e => setAdmission({ ...admission, transportRouteId: e.target.value, transportStopName: '' })}>
                              <option value="">—</option>
                              {routes.map(r => <option key={r.id} value={r.id}>{r.routeName}</option>)}
                            </select>
                          </div>
                          <div className="ap-field">
                            <label className="ap-label">Pickup Stop <span>*</span></label>
                            <select className="ap-select" value={admission.transportStopName}
                              disabled={!selectedRoute}
                              onChange={e => setAdmission({ ...admission, transportStopName: e.target.value })}>
                              <option value="">—</option>
                              {selectedRoute?.stops
                                .slice()
                                .sort((a, b) => a.order - b.order)
                                .map(s => (
                                  <option key={s.name} value={s.name}>
                                    {s.name} · ₹{s.transportFee.toLocaleString('en-IN')}/yr
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>
                      )
                    )}

                    {selectedStop && (
                      <p style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: '#64748B' }}>
                        ₹{selectedStop.transportFee.toLocaleString('en-IN')}/year will be added to the student's fee, split across terms the same way tuition is.
                      </p>
                    )}
                  </div>
                </div>

                <div className="ap-card">
                  <div className="ap-card-head">
                    <div className="ap-card-head-icon"><FileText size={14} /></div>
                    <div className="ap-card-head-text">
                      <h3>Documents Submitted</h3>
                      <p>Mark documents received at the time of admission</p>
                    </div>
                  </div>
                  <div className="ap-card-body">
                    <div className="ap-doc-grid">
                      {([
                        { key: 'docBirthCert',  label: 'Birth Certificate'     },
                        { key: 'docTC',         label: 'Transfer Certificate'  },
                        { key: 'docAadhar',     label: 'Aadhar Card'           },
                        { key: 'docPhoto',      label: 'Passport Photo'        },
                        { key: 'docCasteCert',  label: 'Caste Certificate'     },
                        { key: 'docIncomeCert', label: 'Income Certificate'    },
                      ] as { key: keyof AdmissionInfo; label: string }[]).map(d => (
                        <label key={d.key}
                          className={`ap-doc-item ${admission[d.key] ? 'checked' : ''}`}>
                          <input type="checkbox"
                            checked={!!admission[d.key]}
                            onChange={e => setAdmission({ ...admission, [d.key]: e.target.checked })} />
                          <span className="ap-doc-item-label">{d.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ── Step 5: Review ───────────────────────────────────── */}
            {step === 5 && (
              <div className="ap-card">
                <div className="ap-review-hero">
                  <div className="ap-review-avatar" style={{ background: randomColor() }}>
                    {initials(student.name)}
                  </div>
                  <div>
                    <div className="ap-review-hero-name">{student.name || '—'}</div>
                    <div className="ap-review-hero-sub">
                      Class {admission.applyingForClass || '—'}
                      {admission.sectionPreference ? ` / ${admission.sectionPreference}` : ''}
                    </div>
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span className="ap-badge" style={{ background: '#EFF6FF', color: '#2563EB', borderColor: '#BFDBFE' }}>
                        {student.category}
                      </span>
                      <span className="ap-badge" style={{ background: '#F8FAFC', color: '#475569', borderColor: '#E2E8F0' }}>
                        {student.gender}
                      </span>
                      {student.bloodGroup && (
                        <span className="ap-badge" style={{ background: '#F0FDF4', color: '#16A34A', borderColor: '#BBF7D0' }}>
                          {student.bloodGroup}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="ap-review-section-label">Student</div>
                <div className="ap-review-grid">
                  {[
                    { l: 'Date of Birth',      v: student.dob             },
                    { l: 'Nationality',         v: student.nationality     },
                    { l: 'Religion',            v: student.religion || '—' },
                    { l: 'Aadhar',              v: student.aadhar  || '—', mono: true },
                    { l: 'APAAR ID',            v: student.apaarId || '—', mono: true },
                    { l: 'PEN',                 v: student.penId || '—', mono: true },
                    { l: 'Previous School',     v: student.previousSchool || '—' },
                    { l: 'TC Number',           v: student.tcNumber || '—', mono: true },
                    { l: 'Last Class Passed',   v: student.lastClassPassed ? `Class ${student.lastClassPassed}` : '—' },
                  ].map(r => (
                    <div className="ap-review-item" key={r.l}>
                      <div className="ap-review-label">{r.l}</div>
                      <div className={`ap-review-val${r.mono ? ' mono' : ''}`}>{r.v}</div>
                    </div>
                  ))}
                </div>

                <div className="ap-review-section-label">Parents</div>
                <div className="ap-review-grid">
                  {[
                    { l: "Father's Name",  v: parent.fatherName  || '—' },
                    { l: "Father's Phone", v: parent.fatherPhone || '—', mono: true },
                    { l: "Mother's Name",  v: parent.motherName  || '—' },
                    { l: "Mother's Phone", v: parent.motherPhone || '—', mono: true },
                    { l: 'Annual Income',  v: parent.annualIncome ? `₹ ${parseInt(parent.annualIncome).toLocaleString('en-IN')}` : '—' },
                    { l: 'Sibling',        v: parent.siblingInSchool ? `${parent.siblingName} · Class ${parent.siblingClass}` : 'None' },
                  ].map(r => (
                    <div className="ap-review-item" key={r.l}>
                      <div className="ap-review-label">{r.l}</div>
                      <div className={`ap-review-val${r.mono ? ' mono' : ''}`}>{r.v}</div>
                    </div>
                  ))}
                </div>

                <div className="ap-review-section-label">Address</div>
                <div className="ap-review-grid">
                  <div className="ap-review-item">
                    <div className="ap-review-label">Current Address</div>
                    <div className="ap-review-val">
                      {[address.currentLine1, address.currentLine2, address.currentCity, address.currentState, address.currentPin]
                        .filter(Boolean).join(', ') || '—'}
                    </div>
                  </div>
                  <div className="ap-review-item">
                    <div className="ap-review-label">Permanent Address</div>
                    <div className="ap-review-val">
                      {address.sameAsCurrent
                        ? 'Same as current'
                        : [address.permanentLine1, address.permanentLine2, address.permanentCity, address.permanentState, address.permanentPin]
                            .filter(Boolean).join(', ') || '—'}
                    </div>
                  </div>
                </div>

                <div className="ap-review-section-label">Admission</div>
                <div className="ap-review-grid">
                  {[
                    { l: 'Class',             v: admission.applyingForClass ? `Class ${admission.applyingForClass}` : '—' },
                    { l: 'Section Preference',v: admission.sectionPreference || 'No preference' },
                    { l: 'Roll No',           v: admission.rollNo || '—', mono: true },
                    { l: 'Admission Date',    v: admission.admissionDate || '—' },
                    { l: 'Admission Number',  v: 'Assigned automatically once approved and enrolled', mono: true },
                    { l: 'Transport',         v: admission.transportRequired
                        ? `${routes.find(r => r.id === admission.transportRouteId)?.routeName || '—'} · ${admission.transportStopName || '—'}`
                        : 'Not required' },
                    { l: 'Remarks',           v: admission.remarks || '—' },
                  ].map(r => (
                    <div className="ap-review-item" key={r.l}>
                      <div className="ap-review-label">{r.l}</div>
                      <div className={`ap-review-val${r.mono ? ' mono' : ''}`}>{r.v}</div>
                    </div>
                  ))}
                </div>

                <div className="ap-review-section-label">Documents</div>
                <div style={{ padding: '0.75rem 1.25rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[
                    { key: 'docBirthCert',  label: 'Birth Cert'       },
                    { key: 'docTC',         label: 'TC'               },
                    { key: 'docAadhar',     label: 'Aadhar'           },
                    { key: 'docPhoto',      label: 'Photo'            },
                    { key: 'docCasteCert',  label: 'Caste Cert'       },
                    { key: 'docIncomeCert', label: 'Income Cert'      },
                  ].map(d => {
                    const has = !!admission[d.key as keyof AdmissionInfo];
                    return (
                      <span key={d.key} className="ap-badge"
                        style={has
                          ? { background: '#F0FDF4', color: '#16A34A', borderColor: '#BBF7D0' }
                          : { background: '#F8FAFC', color: '#94A3B8', borderColor: '#E2E8F0' }}>
                        {has ? <Check size={9} style={{ marginRight: 3 }} /> : <X size={9} style={{ marginRight: 3 }} />}
                        {d.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Footer Nav ──────────────────────────────────────────────── */}
        {!success && (
          <div className="ap-footer">
            <div className="ap-footer-info">
              Step <strong>{step}</strong> of <strong>{STEPS.length}</strong>
              {student.name ? <> · <strong>{student.name}</strong></> : ''}
            </div>
            <div className="ap-footer-actions">
              {step > 1 && (
                <button className="ap-btn ap-btn-outline" onClick={handleBack}>
                  <ChevronLeft size={14} /> Back
                </button>
              )}
              {step < STEPS.length ? (
                <button className="ap-btn ap-btn-primary" onClick={handleNext}>
                  Next <ChevronRight size={14} />
                </button>
              ) : (
                <button className="ap-btn ap-btn-primary" disabled={saving} onClick={handleSubmit}>
                  {saving
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</>
                    : <><Check size={14} /> Submit Admission</>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}