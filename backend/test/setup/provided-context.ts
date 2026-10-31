export interface InfrastructureDescriptor {
  runId: string;
  adminUrl: string;
  template: string;
  passwords: { migrator: string; app: string; auth: string };
  valkeyUrl: string;
  s3: {
    endpoint: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
  };
}
export interface FileServices {
  runId: string;
  dbName: string;
  appUrl: string;
  migratorUrl: string;
  valkey: { queueUrl: string; streamsUrl: string; limiterUrl: string };
  queuePrefix: string;
  s3: InfrastructureDescriptor['s3'] & { bucket: string };
}
declare module 'vitest' {
  export interface ProvidedContext {
    infrastructure: InfrastructureDescriptor;
  }
}
