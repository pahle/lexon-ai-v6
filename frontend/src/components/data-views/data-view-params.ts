export const PAGE_SIZES = [10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

export type DataViewParams = {
  query: string;
  page: number;
  pageSize: number;
  facets: Record<string, string[]>;
};

/** Reads `?query=&<facet>=&page=&pageSize=`; invalid values fall back to the defaults. */
export function parseDataViewParams(
  search: URLSearchParams,
  facetKeys: readonly string[],
): DataViewParams {
  const page = Number(search.get('page'));
  const pageSize = Number(search.get('pageSize'));
  return {
    query: (search.get('query') ?? '').trim(),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize)
      ? pageSize
      : DEFAULT_PAGE_SIZE,
    facets: Object.fromEntries(
      facetKeys.map((key) => [key, search.getAll(key).filter(Boolean)]),
    ),
  };
}

/** Writes only non-default values, so the plain list has a clean URL. */
export function serializeDataViewParams(
  state: DataViewParams,
  facetKeys: readonly string[],
): string {
  const out = new URLSearchParams();
  if (state.query) out.set('query', state.query);
  for (const key of facetKeys)
    for (const value of state.facets[key] ?? []) out.append(key, value);
  if (state.page > 1) out.set('page', String(state.page));
  if (state.pageSize !== DEFAULT_PAGE_SIZE)
    out.set('pageSize', String(state.pageSize));
  return out.toString();
}
