export function readContainerImages(
  path: string,
): Readonly<Record<'node' | 'postgres' | 'valkey' | 'seaweedfs', string>>;
