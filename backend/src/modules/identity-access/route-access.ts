import { SetMetadata } from '@nestjs/common';
export interface RouteAccess {
  kind: 'public' | 'workspace' | 'account' | 'platform';
  allowIncompleteMfa?: boolean;
  allowOrganizationSelection?: boolean;
}
export const ROUTE_ACCESS = Symbol('LexonRouteAccess');
export const PublicRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: 'public' } satisfies RouteAccess);
export const AccountRoute = (options: Omit<RouteAccess, 'kind'> = {}) =>
  SetMetadata(ROUTE_ACCESS, {
    kind: 'account',
    ...options,
  } satisfies RouteAccess);
export const PlatformRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: 'platform' } satisfies RouteAccess);
