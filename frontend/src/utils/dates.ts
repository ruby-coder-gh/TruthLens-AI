/**
 * Normalize a bare `YYYY-MM-DD` date (as produced by an `<input type="date">`)
 * to an inclusive start-of-day / end-of-day local timestamp before sending it
 * to the backend as a `date_from`/`date_to` filter.
 *
 * A bare date string parses as midnight, so an unadjusted `date_to` value
 * excludes the entire selected end day from a `created_at <= date_to`
 * comparison — e.g. picking "31 Aug" as the end date would silently drop
 * every row created on the 31st. Appending the last instant of the day makes
 * the end date inclusive; appending the first instant keeps `date_from`
 * symmetric (a no-op for correctness today, but explicit and consistent).
 */
export function startOfDayIso(dateStr: string): string {
  if (!dateStr) return dateStr;
  return `${dateStr}T00:00:00.000`;
}

export function endOfDayIso(dateStr: string): string {
  if (!dateStr) return dateStr;
  return `${dateStr}T23:59:59.999`;
}
