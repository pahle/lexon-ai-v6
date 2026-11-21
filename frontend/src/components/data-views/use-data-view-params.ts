'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import {
  parseDataViewParams,
  serializeDataViewParams,
  type DataViewParams,
} from './data-view-params';

/**
 * The view state of a data list lives in the URL, so back/forward and reloads
 * keep it. A change to the query, a facet, or the page size resets to page 1.
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
  const update = useCallback(
    (patch: Partial<DataViewParams>) => {
      const resets = patch.page === undefined;
      const next = { ...params, ...patch, page: resets ? 1 : patch.page! };
      const qs = serializeDataViewParams(
        next,
        keys ? keys.split('\u0000') : [],
      );
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, keys, pathname, router],
  );
  return { params, update };
}
