/**
 * Η στήλη «Αρχειοθετημένα» είναι ΜΟΝΟ για admin (απόφαση ιδιοκτήτη 2026-09-04)
 * και εμφανίζεται μόνο όταν έχει περιεχόμενο — αλλιώς κάθε board θα κουβαλούσε
 * μια μόνιμα άδεια στήλη στο τέλος.
 */
export function showArchivedColumn(isAdmin: boolean, jobs: { archived: boolean }[]): boolean {
  return isAdmin && jobs.some((j) => j.archived);
}
