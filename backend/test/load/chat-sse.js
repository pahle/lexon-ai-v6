import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

/* global __ENV, __VU, __ITER */

export const options = {
  discardResponseBodies: true,
  scenarios: {
    heldAuthenticatedStreams: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      maxDuration: '120s',
      gracefulStop: '0s',
    },
  },
};

const requestsStarted = new Counter('chat_requests_started');
const requestsCompleted = new Counter('chat_requests_completed');
const http200 = new Counter('chat_http_200');
const errors = new Counter('chat_errors');
const reconnects = new Counter('chat_reconnects');
const requestDuration = new Trend('chat_request_duration_ms');
const requestsPerVu = new Trend('chat_requests_per_vu');
const ownerDiagnostics = [0, 1].map((ownerIndex) => ({
  started: new Counter(`chat_owner_${ownerIndex}_requests_started`),
  completed: new Counter(`chat_owner_${ownerIndex}_requests_completed`),
  requestErrors: new Counter(`chat_owner_${ownerIndex}_request_errors`),
  status2xx: new Counter(`chat_owner_${ownerIndex}_status_2xx`),
  status401403: new Counter(`chat_owner_${ownerIndex}_status_401_403`),
  status404: new Counter(`chat_owner_${ownerIndex}_status_404`),
  status429: new Counter(`chat_owner_${ownerIndex}_status_429`),
  status5xx: new Counter(`chat_owner_${ownerIndex}_status_5xx`),
  statusOther: new Counter(`chat_owner_${ownerIndex}_status_other`),
}));
const owners = JSON.parse(open(__ENV.COOKIE_FILE));

function statusCounterName(status) {
  if (status >= 200 && status < 300) return 'status2xx';
  if (status === 401 || status === 403) return 'status401403';
  if (status === 404) return 'status404';
  if (status === 429) return 'status429';
  if (status >= 500 && status < 600) return 'status5xx';
  return 'statusOther';
}

function ownerSummary(data, ownerIndex) {
  const prefix = `chat_owner_${ownerIndex}_`;
  const count = (name) => data.metrics[`${prefix}${name}`]?.values.count ?? 0;
  return {
    requestsStarted: count('requests_started'),
    requestsCompleted: count('requests_completed'),
    requestErrors: count('request_errors'),
    statuses: {
      '2xx': count('status_2xx'),
      '401/403': count('status_401_403'),
      404: count('status_404'),
      429: count('status_429'),
      '5xx': count('status_5xx'),
      other: count('status_other'),
    },
  };
}

export default function () {
  const ownerIndex = (__VU - 1) % owners.length;
  const owner = owners[ownerIndex];
  const ownerMetrics = ownerDiagnostics[ownerIndex];
  requestsStarted.add(1);
  requestsPerVu.add(1);
  ownerMetrics.started.add(1);
  if (__ITER > 0) reconnects.add(1);

  try {
    const response = http.get(
      `${__ENV.API_BASE_URL}/api/runs/${owner.runId}/events`,
      {
        headers: {
          Accept: 'text/event-stream',
          Cookie: owner.cookie,
          Origin: __ENV.PUBLIC_ORIGIN,
        },
        timeout: '90s',
      },
    );
    requestsCompleted.add(1);
    ownerMetrics.completed.add(1);
    requestDuration.add(response.timings.duration);
    ownerMetrics[statusCounterName(response.status)].add(1);
    if (response.status === 200) http200.add(1);
    else errors.add(1);
  } catch {
    errors.add(1);
    ownerMetrics.requestErrors.add(1);
  }
}

export function handleSummary(data) {
  const count = (name) => data.metrics[name]?.values.count ?? 0;
  const duration = data.metrics.chat_request_duration_ms?.values ?? {};
  const perVu = data.metrics.chat_requests_per_vu?.values ?? {};
  const summary = {
    vus: data.metrics.vus?.values.max ?? 0,
    requestsStarted: count('chat_requests_started'),
    requestsCompleted: count('chat_requests_completed'),
    http200: count('chat_http_200'),
    errors: count('chat_errors'),
    minRequestDurationMs: duration.min ?? null,
    maxRequestsPerVu: perVu.max ?? null,
    reconnects: count('chat_reconnects'),
    diagnostics: {
      owner0: ownerSummary(data, 0),
      owner1: ownerSummary(data, 1),
    },
  };
  return { [__ENV.SUMMARY_FILE]: JSON.stringify(summary) };
}
