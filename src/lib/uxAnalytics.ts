import { monitoring } from '@/lib/monitoring';

export type UxAnalyticsEvent =
  | 'ux_task_started'
  | 'ux_task_completed'
  | 'ux_task_abandoned'
  | 'ux_error_recovered';

export function trackUxEvent(event: UxAnalyticsEvent, metadata: Record<string, unknown> = {}): void {
  try {
    monitoring.recordMetric(event, 1, metadata);
  } catch (error) {
    console.warn(`Failed to record UX event "${event}"`, error);
  }
}
