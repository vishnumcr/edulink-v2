/**
 * --------------------------------------------------------------------
 * File:
 * constants/students.ts
 *
 * Purpose:
 * Static reference data for the Students feature — not business
 * logic, just shared values used by the service (avatar colors) and
 * the page (dropdown options).
 * --------------------------------------------------------------------
 */

export const AVATAR_COLORS = [
  "#6366F1", "#8B5CF6", "#EC4899", "#14B8A6",
  "#F59E0B", "#10B981", "#3B82F6", "#EF4444",
];

export const GRADES = Array.from({ length: 10 }, (_, i) => (i + 1).toString());

export const SECTIONS = ["A", "B", "C", "D"];

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"];