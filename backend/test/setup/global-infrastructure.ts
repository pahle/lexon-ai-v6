import { prepareEvaluationInfrastructure } from '../../src/evaluation/index.js';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  const lease = await prepareEvaluationInfrastructure();
  project.provide('infrastructure', lease.descriptor);
  return lease.release;
}

declare module 'vitest' {
  interface ProvidedContext {
    infrastructure: import('../../src/evaluation/evaluation-contracts.js').EvaluationServices;
  }
}
