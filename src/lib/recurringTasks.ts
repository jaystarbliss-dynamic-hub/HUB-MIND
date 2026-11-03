import { materializeRecurringTasksForDate } from './recurrenceEngine';

/** @deprecated Use recurrenceEngine.materializeRecurringTasksForDate directly. */
export async function processRecurringTasks(date = new Date(), userContext?: { id: string; role?: string }) {
  return materializeRecurringTasksForDate(date, userContext);
}
