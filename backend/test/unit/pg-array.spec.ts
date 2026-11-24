import { describe, expect, it } from 'vitest';
import { pgArray } from '../../src/infrastructure/db/index.js';
import { renderSql } from '../../src/infrastructure/db/testing/sql-render.js';

describe('pgArray', () => {
  it('escapes a double quote inside an element', () => {
    const rendered = renderSql(pgArray(['a"b'], 'text[]', ['a"b']));
    // The single bound parameter is the array literal PostgreSQL parses as
    // the one element a"b.
    expect(rendered.params).toEqual(['{"a\\"b"}']);
  });
  it('escapes a backslash inside an element', () => {
    const rendered = renderSql(pgArray(['a\\b'], 'text[]', ['a\\b']));
    expect(rendered.params).toEqual(['{"a\\\\b"}']);
  });
  it('rejects a value outside the allowed set without echoing it', () => {
    let error: unknown;
    try {
      pgArray(['x'], 'text[]', ['active']);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeTruthy();
    const shape = error as { status?: unknown; statusCode?: unknown };
    expect([shape.statusCode, shape.status]).toContain(400);
    expect(String((error as { message?: unknown }).message)).not.toContain('x');
    expect(JSON.stringify(error)).not.toContain('x');
  });
});
