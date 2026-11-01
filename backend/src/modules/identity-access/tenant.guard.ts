import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { AuthLimiter } from '../../infrastructure/queue/index.js';
import { IdentitySessionService } from './identity-session.service.js';
import { RequestIdentity } from './request-identity.js';
import { ROUTE_ACCESS, type RouteAccess } from './route-access.js';
import { credentialChannel } from './credential-channel.js';
import { IdentityError } from './identity-error.js';

const overrideKeys = [
  'orgId',
  'tenantId',
  'tenant',
  'tenantContext',
  'userId',
  'activeOrganizationId',
];
function rejectsOverride(value: unknown, selectionInput = false): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [...overrideKeys, ...(selectionInput ? [] : ['organizationId'])].some(
    (key) => Object.hasOwn(value, key),
  );
}
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly identities: IdentitySessionService,
    private readonly requests: RequestIdentity,
    private readonly availability: Pick<AuthLimiter, 'assertAvailable'>,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<RouteAccess>(ROUTE_ACCESS, [
      context.getHandler(),
      context.getClass(),
    ]) ?? { kind: 'workspace' };
    if (access.kind === 'public') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    for (const name of [
      'x-org-id',
      'x-organization-id',
      'x-tenant-id',
      'x-user-id',
      'x-active-organization-id',
      'x-lexon-org-id',
    ])
      if (request.headers[name] !== undefined)
        throw new IdentityError('VALIDATION_ERROR', 400);
    if (
      rejectsOverride(request.query) ||
      rejectsOverride(request.body, access.allowOrganizationSelection)
    )
      throw new IdentityError('VALIDATION_ERROR', 400);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    credentialChannel(headers, request.rawHeaders);
    try {
      await this.availability.assertAvailable();
      const resolved = await this.identities.resolve(
        headers,
        access,
        (cookies) => {
          const existing = response.getHeader('set-cookie');
          response.setHeader('set-cookie', [
            ...(Array.isArray(existing)
              ? existing
              : typeof existing === 'string'
                ? [existing]
                : []),
            ...cookies,
          ]);
        },
      );
      if (resolved.summary.fallbackReason)
        response.setHeader(
          'x-lexon-fallback-reason',
          resolved.summary.fallbackReason,
        );
      this.requests.prepare(request, resolved, headers);
      return true;
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError('AUTH_UNAVAILABLE', 503);
    }
  }
}
