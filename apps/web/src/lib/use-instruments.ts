'use client';

import { PRIVATE_INSTRUMENTS, GROUP_INSTRUMENTS, ALL_INSTRUMENTS } from '@music-life/types';
import { useApi } from './swr';

export interface OrgInstrument {
  id: string; name: string; availablePrivate: boolean; availableGroup: boolean;
  note: string | null; active: boolean; sortOrder: number;
}

/**
 * The studio's own editable instrument list (Settings > Instruments), not the
 * hardcoded PRIVATE_INSTRUMENTS/GROUP_INSTRUMENTS/ALL_INSTRUMENTS built-ins.
 * Every admin-side instrument picker (Add lesson, Add/Edit enrollment, staff
 * "instruments taught", Add student) must read from here — a picker still
 * importing the static arrays directly is why an instrument added in Settings
 * never showed up anywhere to actually pick it. Falls back to the built-ins
 * only until the real list has loaded, so pickers never render empty.
 */
export function useInstruments() {
  const { data, isLoading } = useApi<OrgInstrument[]>('/instruments');
  const active = (data ?? []).filter(i => i.active);
  const loaded = !!data;
  return {
    loading: isLoading,
    all: loaded ? active.map(i => i.name) : [...ALL_INSTRUMENTS],
    private: loaded ? active.filter(i => i.availablePrivate).map(i => i.name) : [...PRIVATE_INSTRUMENTS],
    group: loaded ? active.filter(i => i.availableGroup).map(i => i.name) : [...GROUP_INSTRUMENTS],
  };
}
