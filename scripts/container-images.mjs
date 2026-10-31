import { readFileSync } from 'node:fs';

export function readContainerImages(path) {
  const values = new Map(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  const result = {};
  for (const name of ['node', 'postgres', 'valkey', 'seaweedfs']) {
    const value = values.get(`${name.toUpperCase()}_IMAGE`);
    if (!value || !/^[\w./-]+:\d+[\w.-]*@sha256:[a-f0-9]{64}$/.test(value))
      throw new Error(`Image ${name} must have an exact tag and digest`);
    result[name] = value;
  }
  return Object.freeze(result);
}
