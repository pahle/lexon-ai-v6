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
 * in the same URL update unless the patch names a page. A facet patch
 * changes only the facets it names.
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
  // Reads the URL as of the last write, so sets made before the URL update
  // lands (router.replace is a transition) build on each other. Only a new
  // URL replaces it; a re-render with the old URL keeps the pending write.
  const searchString = search.toString();
  const latest = useRef(searchString);
  const seen = useRef(searchString);
  if (seen.current !== searchString) {
    seen.current = searchString;
    latest.current = searchString;
  }
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
        // A facet patch names only the facets it changes.
        facets: { ...current.facets, ...patch.facets },
        page: patch.page ?? 1,
      };
      const qs = serializeDataViewParams(next, list);
      latest.current = qs;
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [keys, pathname, router],
  );
  const reset = useCallback(() => {
    latest.current = '';
    router.replace(pathname);
  }, [pathname, router]);
  return { ...params, set, reset };
}
