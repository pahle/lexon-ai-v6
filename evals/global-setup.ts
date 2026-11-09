import { prepareEvaluationInfrastructure } from '@lexon/backend/evaluation';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  const lease = await prepareEvaluationInfrastructure();
  project.provide('evaluationServices', lease.descriptor);
  return lease.release;
}

declare module 'vitest' {
  interface ProvidedContext {
    evaluationServices: import('@lexon/backend/evaluation').EvaluationServices;
  }
}
