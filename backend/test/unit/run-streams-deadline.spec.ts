import { expect, test } from 'vitest';
import {
  RunStreams,
  type RunStreamAuthority,
} from '../../src/infrastructure/queue/run-streams.js';

const authority = {} as RunStreamAuthority;

async function deadlineOf(publicationDeadlineMs?: number) {
  const streams = new RunStreams({
    url: 'redis://127.0.0.1:1',
    prefix: 'unit',
    authority,
    ...(publicationDeadlineMs === undefined ? {} : { publicationDeadlineMs }),
  });
  try {
    return streams.publicationDeadlineMs;
  } finally {
    await streams.close();
  }
}

test('publication deadline is a constructor option, default 250', async () => {
  expect(await deadlineOf()).toBe(250);
  expect(await deadlineOf(2000)).toBe(2000);
});
