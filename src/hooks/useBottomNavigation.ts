import { useCallback, useEffect, useState } from 'react';
import {
  getBottomNavigation,
  resetBottomNavigation,
  setBottomNavigation,
  subscribeBottomNavigation,
  type MobileNavId,
} from '@/lib/bottomNavigation';

export function useBottomNavigation() {
  const [itemIds, setItemIdsState] = useState<MobileNavId[]>(() => getBottomNavigation());

  useEffect(() => subscribeBottomNavigation(() => {
    setItemIdsState(getBottomNavigation());
  }), []);

  const updateItemIds = useCallback((next: MobileNavId[] | ((current: MobileNavId[]) => MobileNavId[])) => {
    const current = getBottomNavigation();
    const nextValue = typeof next === 'function' ? next(current) : next;
    return setBottomNavigation(nextValue);
  }, []);

  const restoreDefaults = useCallback(() => resetBottomNavigation(), []);

  return {
    itemIds,
    updateItemIds,
    restoreDefaults,
  };
}
