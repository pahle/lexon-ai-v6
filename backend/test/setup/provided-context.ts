import type { EvaluationServices } from '../../src/evaluation/evaluation-contracts.js';

export type InfrastructureDescriptor = EvaluationServices;

export interface FileServices {
  runId: string;
  dbName: string;
  appUrl: string;
  authUrl: string;
  migratorUrl: string;
  valkey: { queueUrl: string; streamsUrl: string; limiterUrl: string };
  queuePrefix: string;
  s3: {
    endpoint: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    bucket: string;
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    infrastructure: InfrastructureDescriptor;
  }
}
