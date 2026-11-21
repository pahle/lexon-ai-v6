'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';
import {
  parseDataViewParams,
  serializeDataViewParams,
  type DataViewParams,
} from './data-view-params';

/**
 * The view state of a data list lives in the URL, so back/forward and reloads
 * keep it. A change to the query, a facet, or the page size resets to page 1
 * in the same URL update unless the patch names a page.
 */
export function useDataViewParams(facetKeys: readonly string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const keys = facetKeys.join('\u0000');
  const params = useMemo(
    () =>
      parseDataViewParams(
        new URLSearchParams(search.toString()),
        keys ? keys.split('\u0000') : [],
      ),
    [search, keys],
  );
  // Reads the URL as of the last write, so two sets in one tick both survive.
  const latest = useRef(search.toString());
  latest.current = search.toString();
  const set = useCallback(
    (patch: Partial<DataViewParams>) => {
      const list = keys ? keys.split('\u0000') : [];
      const current = parseDataViewParams(
        new URLSearchParams(latest.current),
        list,
      );
      const next = {
        ...current,
        ...patch,
        page: patch.page ?? 1,
      };
      const qs = serializeDataViewParams(next, list);
      latest.current = qs;
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [keys, pathname, router],
  );
  return { params, set };
}
