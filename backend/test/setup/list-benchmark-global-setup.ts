import type { TestProject } from 'vitest/node';
import preparePackages from '../../../scripts/test/prepare-packages.js';

export default async function setupListBenchmark(project: TestProject) {
  await preparePackages();
  const { default: initializeInfrastructure } =
    await import('./global-infrastructure.js');
  return initializeInfrastructure(project);
}
