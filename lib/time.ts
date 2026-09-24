import { format, parseISO } from "date-fns";
import { Event } from "@/types";

/**
 * Parse UTC ISO string to Date
 */
export function parseUTC(iso: string): Date {
  return parseISO(iso);
}

/**
 * Format UTC time to local timezone display
 */
export function formatLocal(utc: string, formatStr: string = "MMM d, h:mm a"): string {
  return format(parseISO(utc), formatStr);
}

/**
 * Group events by day
 */
export function groupByDay(events: Event[]): Map<string, Event[]> {
  const grouped = new Map<string, Event[]>();
  
  for (const event of events) {
    const dayKey = format(parseISO(event.time), "yyyy-MM-dd");
    const existing = grouped.get(dayKey) || [];
    existing.push(event);
    grouped.set(dayKey, existing);
  }
  
  return grouped;
}

/**
 * Get day label for display
 */
export function getDayLabel(dateStr: string): string {
  return format(parseISO(dateStr), "EEEE, MMMM d");
}

/**
 * Compare two ISO timestamps
 */
export function compareTimes(a: string, b: string): number {
  return parseISO(a).getTime() - parseISO(b).getTime();
}

