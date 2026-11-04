import assert from 'node:assert/strict';
import test from 'node:test';
import { orderExactCaptureRows } from './visual-capture-normalizations.mjs';

const orderedEmails = [
  'sam.taylor@example.test',
  'alex.rivera@example.test',
  'jordan.lee@example.test',
];

test('canonicalizes only the exact complete invitation page without mutating rows or metadata', () => {
  const body = {
    items: [
      { id: '3', email: orderedEmails[2], role: 'owner', status: 'pending' },
      { id: '1', email: orderedEmails[0], role: 'member', status: 'pending' },
      { id: '2', email: orderedEmails[1], role: 'admin', status: 'pending' },
    ],
    pageInfo: { nextCursor: null, previousCursor: null },
    version: 1,
  };
  const originalRows = body.items.map((item) => ({ ...item }));
  const originalPageInfo = { ...body.pageInfo };

  const result = orderExactCaptureRows(body, orderedEmails, 'Invitation');

  assert.deepEqual(
    result.items.map((item) => item.email),
    orderedEmails,
  );
  assert.deepEqual(result.items, [
    originalRows[1],
    originalRows[2],
    originalRows[0],
  ]);
  assert.notEqual(result.items, body.items);
  assert.deepEqual(body.items, originalRows);
  assert.deepEqual(result.pageInfo, originalPageInfo);
  assert.deepEqual(body.pageInfo, originalPageInfo);
  assert.equal(result.version, body.version);
});

test('rejects incomplete, duplicate, unexpected, or paginated invitation responses', () => {
  const body = {
    items: orderedEmails.map((email, index) => ({ id: String(index), email })),
    pageInfo: { nextCursor: null },
  };
  assert.throws(
    () =>
      orderExactCaptureRows(
        { ...body, pageInfo: { nextCursor: 'next-page' } },
        orderedEmails,
        'Invitation',
      ),
    /unpaginated response/,
  );
  assert.throws(
    () =>
      orderExactCaptureRows(
        { ...body, items: body.items.slice(0, 2) },
        orderedEmails,
        'Invitation',
      ),
    /exactly the three indexed synthetic email rows/,
  );
  assert.throws(
    () =>
      orderExactCaptureRows(
        {
          ...body,
          items: [
            body.items[0],
            body.items[1],
            { id: 'x', email: 'other@example.test' },
          ],
        },
        orderedEmails,
        'Invitation',
      ),
    /exactly the three indexed synthetic email rows/,
  );
  assert.throws(
    () =>
      orderExactCaptureRows(
        {
          ...body,
          items: [body.items[0], body.items[1], body.items[0]],
        },
        orderedEmails,
        'Invitation',
      ),
    /exactly the three indexed synthetic email rows/,
  );
});

test('canonicalizes the complete member page in indexed order with the actual current member row intact', () => {
  const memberEmails = [
    'maya.chen@example.test',
    'jordan.lee@example.test',
    'alex.rivera@example.test',
  ];
  const body = {
    items: [
      { id: 'alex-id', email: memberEmails[2], role: 'member' },
      { id: 'maya-id', email: memberEmails[0], role: 'owner' },
      { id: 'jordan-id', email: memberEmails[1], role: 'admin' },
    ],
    pageInfo: { nextCursor: null },
  };
  const originalItems = body.items.map((item) => ({ ...item }));
  const result = orderExactCaptureRows(body, memberEmails, 'Member');

  assert.deepEqual(
    result.items.map(({ email }) => email),
    memberEmails,
  );
  assert.deepEqual(result.items, [
    originalItems[1],
    originalItems[2],
    originalItems[0],
  ]);
  assert.deepEqual(body.items, originalItems);
  assert.deepEqual(result.pageInfo, body.pageInfo);
  assert.equal(result.items[0].role, 'owner');
});

test('member capture ordering rejects a response with a next page', () => {
  assert.throws(
    () =>
      orderExactCaptureRows(
        {
          items: [
            { email: 'maya.chen@example.test' },
            { email: 'jordan.lee@example.test' },
            { email: 'alex.rivera@example.test' },
          ],
          pageInfo: { nextCursor: 'next-page' },
        },
        [
          'maya.chen@example.test',
          'jordan.lee@example.test',
          'alex.rivera@example.test',
        ],
        'Member',
      ),
    /unpaginated response/,
  );
});
