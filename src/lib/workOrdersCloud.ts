export type WorkOrdersCloudState = 'loading' | 'ready' | 'unavailable';

export function getWorkOrdersCloudState(business: unknown): WorkOrdersCloudState {
  if (business === undefined) return 'loading';
  return business ? 'ready' : 'unavailable';
}

export function requireWorkOrdersCloud(state: WorkOrdersCloudState): void {
  if (state !== 'ready') {
    throw new Error('Work Orders requires a connected cloud business.');
  }
}
