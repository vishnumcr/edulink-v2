/**
 * --------------------------------------------------------------------
 * File:
 * constants/results.ts
 *
 * Purpose:
 * Static reference data for the Results feature.
 *
 * Grade bands are a sane CBSE-style default (A1 down to E) — not
 * something every school will want. If a school needs its own
 * grading scale, this is the one place to change it; nothing else
 * hardcodes grade letters.
 * --------------------------------------------------------------------
 */

export interface GradeBand {
  minPercentage: number;
  grade: string;
}

export const GRADE_BANDS: GradeBand[] = [
  { minPercentage: 91, grade: "A1" },
  { minPercentage: 81, grade: "A2" },
  { minPercentage: 71, grade: "B1" },
  { minPercentage: 61, grade: "B2" },
  { minPercentage: 51, grade: "C1" },
  { minPercentage: 41, grade: "C2" },
  { minPercentage: 33, grade: "D" },
  { minPercentage: 0, grade: "E" },
];

/** A student is treated as "passed" at or above this percentage, for class pass-rate stats. */
export const PASS_PERCENTAGE_THRESHOLD = 33;