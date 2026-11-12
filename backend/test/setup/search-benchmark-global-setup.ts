import type { TestProject } from 'vitest/node';
import preparePackages from '../../../scripts/test/prepare-packages.js';
import initializeSearchEvidence from './search-benchmark-evidence.js';

export default async function setupSearchBenchmark(project: TestProject) {
  initializeSearchEvidence();
  await preparePackages();
  const { default: initializeInfrastructure } = await import(
    './global-infrastructure.js'
  );
  return initializeInfrastructure(project);
}
