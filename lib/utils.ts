import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const NO_SECTION_ID = "__no_section__";


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}