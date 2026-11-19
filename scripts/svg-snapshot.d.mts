export function isSvgSnapshotUpdate(
  env?: Record<string, string | undefined>,
): boolean;
export function checkSvgSnapshot(options: {
  file: string;
  id: string;
  markup: string;
  update: boolean;
}): void;
export function assertStableSvgRead(
  id: string,
  first: string,
  second: string,
): void;
