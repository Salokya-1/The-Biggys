/**
 * A three-year degree runs six semesters, two to a year: 1–2 is first year, 3–4 second, 5–6 third.
 *
 * People think in years — "the second years sit their exams next week" — and the system stored
 * only semester numbers, so every filter asked a question nobody phrases that way. The year is
 * derived rather than stored, because it is not a separate fact: it is what the semester number
 * already means.
 */
export const yearOfSemester = (semesterNumber: number) => Math.max(1, Math.ceil(semesterNumber / 2));

/** The two semesters that make up a year of the programme. */
export const semestersInYear = (year: number) => [year * 2 - 1, year * 2];

export const YEARS = [1, 2, 3] as const;

export const yearLabel = (year: number) => {
  const [a, b] = semestersInYear(year);
  return `Year ${year} · semesters ${a}–${b}`;
};

/** "Year 2 · Semester 4", the way it reads on a notice. */
export const yearAndSemester = (semesterNumber: number) => `Year ${yearOfSemester(semesterNumber)} · Semester ${semesterNumber}`;
