import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withOwnedStack } from '../e2e-lifecycle.mjs';
import { SYNTHETIC_OBSERVATIONS } from './fixtures/chat-load-observations.mjs';

async function capture(observations, events) {
  return withOwnedStack({
    project: 'lexon-e2e-18aabb',
    directory: '/tmp/lexon-e2e-task18',
    captureChatLoad: true,
    async start() {
      events.push('start');
    },
    async exercise() {
      events.push('exercise');
      return observations;
    },
    async down() {
      events.push('down');
    },
    async remove() {
      events.push('remove');
    },
  });
}

function addAdditionalPurposeCounts(observations, healthCounts) {
  const withPurposeCounts = (existing, health) => ({
    ...existing,
    queue: 1,
    auth: 1,
    notifications: 1,
    other: 0,
    ...(health === undefined ? {} : { health }),
  });
  observations.warmBaseline.valkeyClientsByPurpose = withPurposeCounts(
    observations.warmBaseline.valkeyClientsByPurpose,
    healthCounts?.warmPeak,
  );
  for (const [index, sample] of observations.plateauSamples.entries())
    sample.valkeyClientsByPurpose = withPurposeCounts(
      sample.valkeyClientsByPurpose,
      healthCounts?.plateau[index],
    );
  observations.teardown.valkeyClientsByPurpose = withPurposeCounts(
    observations.teardown.valkeyClientsByPurpose,
    healthCounts?.teardown,
  );
  return observations;
}

async function tryCapture(observations) {
  const events = [];
  let report;
  let error;
  try {
    report = await capture(observations, events);
  } catch (caught) {
    error = caught;
  }
  return { report, error, events };
}

test('load capture returns a safe passing report for complete synthetic observations', async () => {
  const events = [];
  const report = await capture(structuredClone(SYNTHETIC_OBSERVATIONS), events);

  assert.equal(report?.passed, true);
  assert.equal(report?.plateauDurationMs, 30_000);
  assert.equal(
    report?.provenance?.sourceHead,
    SYNTHETIC_OBSERVATIONS.provenance.sourceHead,
  );
  assert.equal(report?.config?.perUserSseLimit, 256);
  assert.equal(
    report?.defaultSixQualification?.seventhConnectionEvictedOldest,
    true,
  );
  assert.equal(report?.warmBaseline?.activeSubscriptions, 0);
  assert.equal(report?.warmBaseline?.activeLeases, 0);
  assert.equal(report?.warmBaseline?.readerConnections, 1);
  assert.equal(report?.oneSubscriberBaseline?.readerConnections, 2);
  assert.ok(report?.plateauSamples?.length >= 7);
  assert.ok(
    report.plateauSamples.every((sample) => sample.activeSubscriptions >= 500),
  );
  assert.ok(
    report.plateauSamples.every((sample) => sample.readerConnections === 2),
  );
  assert.equal(
    report.plateauSamples.at(-1).elapsedMs - report.plateauSamples[0].elapsedMs,
    30_000,
  );
  assert.equal(report?.k6?.requestsStarted, 500);
  assert.equal(report?.k6?.requestsCompleted, 500);
  assert.equal(report?.k6?.http200, 500);
  assert.equal(report?.k6?.errors, 0);
  assert.equal(report?.k6?.minRequestDurationMs, 30_000);
  assert.equal(report?.k6?.maxRequestsPerVu, 1);
  assert.equal(report?.k6?.reconnects, 0);
  assert.deepEqual(report?.worker?.sequenceBefore, [10, 20]);
  assert.deepEqual(report?.worker?.sequenceAfter, [11, 21]);
  assert.equal(report?.worker?.progressedRuns, 2);
  assert.equal(report?.teardown?.activeSubscriptions, 0);
  assert.equal(report?.teardown?.activeLeases, 0);
  assert.equal(report?.teardown?.readerSubscriptions, 0);
  assert.equal(report?.teardown?.readerConnections, 1);
  assert.equal(report?.latency?.coldMs, 120_000);
  assert.equal(report?.latency?.medianMs, 30);
  assert.equal(report?.latency?.p95Ms, 120_000);
  assert.equal(report?.latency?.maxMs, 120_000);
  assert.doesNotMatch(
    JSON.stringify(report),
    /privatePrompt|answerBody|sessionCookie|ownerId|runId/u,
  );
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});

test('invalid load observations reject and still tear down the owned stack', async (t) => {
  const invalidCases = [
    [
      'peak-only subscriber sample',
      (value) => {
        value.plateauSamples = [value.plateauSamples.at(-1)];
      },
    ],
    [
      'sparse plateau samples despite a 30-second span',
      (value) => {
        value.plateauSamples = [
          value.plateauSamples[0],
          value.plateauSamples.at(-1),
        ];
      },
    ],
    [
      'less than 500 live hub subscribers',
      (value) => {
        value.plateauSamples[3].activeSubscriptions = 499;
      },
    ],
    [
      'reader connection growth over the one-subscriber baseline',
      (value) => {
        value.plateauSamples[4].readerConnections = 3;
      },
    ],
    [
      'limiter connection growth during plateau',
      (value) => {
        value.plateauSamples[4].valkeyClientsByPurpose.limiter = 2;
      },
    ],
    [
      'growth in an additional fixed Valkey purpose',
      (value) => {
        addAdditionalPurposeCounts(value);
        value.plateauSamples[4].valkeyClientsByPurpose.queue = 2;
      },
    ],
    [
      'health purpose count above its observed warm peak',
      (value) => {
        addAdditionalPurposeCounts(value, {
          warmPeak: 2,
          plateau: [0, 1, 2, 2, 1, 0, 0],
          teardown: 0,
        });
        value.plateauSamples[3].valkeyClientsByPurpose.health = 3;
      },
    ],
    [
      'unrecognized Valkey purpose with private payload',
      (value) => {
        addAdditionalPurposeCounts(value);
        value.plateauSamples[0].valkeyClientsByPurpose.privatePayload =
          'synthetic-sensitive-canary';
      },
    ],
    [
      'missing default-six eviction qualification',
      (value) => {
        value.defaultSixQualification = undefined;
      },
    ],
    [
      'false default-six eviction qualification',
      (value) => {
        value.defaultSixQualification.seventhConnectionEvictedOldest = false;
      },
    ],
    [
      'per-user SSE cap differs from the measured profile',
      (value) => {
        value.config.perUserSseLimit = 255;
      },
    ],
    [
      'owner count differs from the measured profile',
      (value) => {
        value.config.owners = 1;
      },
    ],
    [
      'separate organization count differs from the measured profile',
      (value) => {
        value.config.separateOrganizations = 1;
      },
    ],
    [
      'subscribers per owner differs from the measured profile',
      (value) => {
        value.config.subscribersPerOwner = 249;
      },
    ],
    [
      'active mock run count differs from the measured profile',
      (value) => {
        value.config.activeMockRuns = 1;
      },
    ],
    [
      'API memory limit differs from the architecture profile',
      (value) => {
        value.config.apiMemoryLimitMiB = 1535;
      },
    ],
    [
      'API CPU limit differs from the architecture profile',
      (value) => {
        value.config.apiCpuLimit = 0.5;
      },
    ],
    [
      'load-tool memory limit differs from the measured profile',
      (value) => {
        value.config.loadToolMemoryLimitMiB = 2047;
      },
    ],
    [
      'load-tool CPU limit differs from the measured profile',
      (value) => {
        value.config.loadToolCpuLimit = 1;
      },
    ],
    [
      'global active-run cap differs from the F3 cap',
      (value) => {
        value.config.runCaps.global = 23;
      },
    ],
    [
      'per-organization active-run cap differs from the F3 cap',
      (value) => {
        value.config.runCaps.perOrganization = 5;
      },
    ],
    [
      'test timeout differs from the measured profile',
      (value) => {
        value.config.testTimeoutSeconds = 179;
      },
    ],
    [
      'early HTTP close before the 30-second plateau',
      (value) => {
        value.k6.minRequestDurationMs = 29_999;
      },
    ],
    [
      'incomplete k6 completion/error counts',
      (value) => {
        value.k6.requestsCompleted = 499;
        value.k6.http200 = 499;
        value.k6.errors = 1;
      },
    ],
    [
      'more than one request or reconnect per VU',
      (value) => {
        value.k6.maxRequestsPerVu = 2;
        value.k6.reconnects = 1;
      },
    ],
    [
      'subscriptions left after teardown',
      (value) => {
        value.teardown.activeSubscriptions = 1;
      },
    ],
    [
      'leases left after teardown',
      (value) => {
        value.teardown.activeLeases = 1;
      },
    ],
    [
      'reader subscription count does not return to the warm baseline',
      (value) => {
        value.teardown.readerSubscriptions = 1;
      },
    ],
    [
      'reader connection count differs from warm baseline after teardown',
      (value) => {
        value.teardown.readerConnections = 3;
      },
    ],
    [
      'worker stream did not advance on both runs',
      (value) => {
        value.worker.sequenceAfter[1] = value.worker.sequenceBefore[1];
      },
    ],
    [
      'memory above configured API ceiling',
      (value) => {
        value.plateauSamples[2].apiMemoryBytes = 1_610_612_736;
      },
    ],
    [
      'multiple API PIDs within one plateau',
      (value) => {
        value.plateauSamples[2].apiPid = 4102;
      },
    ],
    [
      'missing API process provenance',
      (value) => {
        delete value.provenance.apiPid;
      },
    ],
    [
      'missing pinned image provenance',
      (value) => {
        delete value.provenance.images.k6;
      },
    ],
    [
      'malformed source-head provenance',
      (value) => {
        value.provenance.sourceHead = 'not-a-commit';
      },
    ],
    [
      'unsafe image provenance value',
      (value) => {
        value.provenance.images.k6 = 'private-image-canary';
      },
    ],
    [
      'zero API process identifier',
      (value) => {
        value.provenance.apiPid = 0;
      },
    ],
    [
      'zero API resident memory sample',
      (value) => {
        value.plateauSamples[2].apiMemoryBytes = 0;
      },
    ],
    [
      'missing cold or warm latency samples',
      (value) => {
        value.latency.warmSamplesMs = [];
      },
    ],
    [
      'non-finite latency sample',
      (value) => {
        value.latency.warmSamplesMs[0] = Number.NaN;
      },
    ],
    [
      'unknown private payload field',
      (value) => {
        value.privatePrompt = 'synthetic-sensitive-canary';
      },
    ],
  ];

  for (const [name, invalidate] of invalidCases) {
    await t.test(name, async () => {
      const observations = structuredClone(SYNTHETIC_OBSERVATIONS);
      invalidate(observations);
      const events = [];
      const failure = await capture(observations, events).then(
        () => undefined,
        (error) => error,
      );

      assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
      assert.ok(failure instanceof Error, `${name} should reject capture`);
      assert.equal(
        failure.message,
        'Chat load evidence is incomplete or invalid.',
      );
      assert.doesNotMatch(
        `${failure.name}: ${failure.message}`,
        /synthetic-sensitive-canary|private-image-canary|privatePrompt|sessionCookie|ownerId|runId/u,
      );
    });
  }
});

test('local runner provenance is recorded without requiring an Ubuntu runner', async () => {
  const observations = structuredClone(SYNTHETIC_OBSERVATIONS);
  observations.provenance.runnerImage = 'local-docker/darwin-arm64';
  const { report, error, events } = await tryCapture(observations);

  assert.equal(error, undefined);
  assert.equal(report?.provenance?.runnerImage, 'local-docker/darwin-arm64');
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});

test('dirty source provenance is reported honestly for local capture', async () => {
  const observations = structuredClone(SYNTHETIC_OBSERVATIONS);
  observations.provenance.sourceDirty = true;
  const { report, error, events } = await tryCapture(observations);

  assert.equal(error, undefined);
  assert.equal(report?.provenance?.sourceDirty, true);
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});

test('fixed additional Valkey purposes are preserved in aggregate evidence', async () => {
  const observations = addAdditionalPurposeCounts(
    structuredClone(SYNTHETIC_OBSERVATIONS),
  );
  const { report, error, events } = await tryCapture(observations);

  assert.equal(error, undefined);
  assert.deepEqual(report?.warmBaseline?.valkeyClientsByPurpose, {
    reader: 1,
    limiter: 1,
    control: 1,
    queue: 1,
    auth: 1,
    notifications: 1,
    other: 0,
  });
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});

test('transient health Valkey clients remain bounded by observed warm peak', async () => {
  const observations = addAdditionalPurposeCounts(
    structuredClone(SYNTHETIC_OBSERVATIONS),
    {
      warmPeak: 2,
      plateau: [0, 1, 2, 2, 1, 0, 0],
      teardown: 0,
    },
  );
  const { report, error, events } = await tryCapture(observations);

  assert.equal(error, undefined);
  assert.equal(report?.warmBaseline?.valkeyClientsByPurpose.health, 2);
  assert.ok(
    report.plateauSamples.every(
      (sample) => sample.valkeyClientsByPurpose.health <= 2,
    ),
  );
  assert.equal(report?.teardown?.valkeyClientsByPurpose.health, 0);
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});

test('health clients may remain at teardown within the observed warm peak', async () => {
  const observations = addAdditionalPurposeCounts(
    structuredClone(SYNTHETIC_OBSERVATIONS),
    {
      warmPeak: 2,
      plateau: [0, 1, 2, 2, 1, 0, 0],
      teardown: 1,
    },
  );
  const { report, error, events } = await tryCapture(observations);

  assert.equal(error, undefined);
  assert.equal(report?.warmBaseline?.valkeyClientsByPurpose.health, 2);
  assert.equal(report?.teardown?.valkeyClientsByPurpose.health, 1);
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});

test('finite sub-millisecond first-frame latency is retained without a floor', async () => {
  const observations = structuredClone(SYNTHETIC_OBSERVATIONS);
  observations.latency.warmSamplesMs[0] = 0.25;
  const { report, error, events } = await tryCapture(observations);

  assert.equal(error, undefined);
  assert.equal(report?.latency?.warmSamplesMs[0], 0.25);
  assert.deepEqual(events, ['start', 'exercise', 'down', 'remove']);
});
