import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StoragePort } from './storage-port.js';
export interface StorageOptions {
  endpoint: string;
  publicEndpoint?: string;
  bucket: string;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
  healthTimeoutMs?: number;
}
export class S3Storage extends StoragePort {
  readonly #client: S3Client;
  readonly #signer: S3Client;
  constructor(private readonly options: StorageOptions) {
    super();
    const common = {
      region: options.region,
      credentials: options.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
    };
    this.#client = new S3Client({ ...common, endpoint: options.endpoint });
    this.#signer = new S3Client({
      ...common,
      // The presigner has no body yet; never sign a checksum for an empty body.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      endpoint: options.publicEndpoint ?? options.endpoint,
    });
  }
  async put(key: string, body: Uint8Array): Promise<void> {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: body,
        }),
      );
    } catch {
      throw new Error('Storage operation failed');
    }
  }
  async get(
    key: string,
    range?: { start: number; endInclusive: number },
  ): Promise<Uint8Array> {
    if (
      range &&
      (!Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.endInclusive) ||
        range.start < 0 ||
        range.endInclusive < range.start)
    )
      throw new Error('Invalid byte range');
    try {
      const result = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          ...(range
            ? { Range: `bytes=${range.start}-${range.endInclusive}` }
            : {}),
        }),
      );
      if (!result.Body) throw new Error('Empty response');
      return await result.Body.transformToByteArray();
    } catch (error) {
      // SDK causes may contain endpoints, object keys and signed request data.
      if (error instanceof Error && error.name === 'NoSuchKey') {
        // eslint-disable-next-line preserve-caught-error -- Boundary errors deliberately omit sensitive SDK causes.
        throw new Error('Object not found');
      }
      // eslint-disable-next-line preserve-caught-error -- Boundary errors deliberately omit sensitive SDK causes.
      throw new Error('Storage operation failed');
    }
  }
  async delete(key: string): Promise<void> {
    try {
      await this.#client.send(
        new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
    } catch {
      throw new Error('Storage operation failed');
    }
  }
  async presignPut(key: string, expiresInSeconds: number): Promise<string> {
    if (
      !Number.isSafeInteger(expiresInSeconds) ||
      expiresInSeconds < 1 ||
      expiresInSeconds > 604800
    )
      throw new Error('Invalid presign expiry');
    try {
      return await getSignedUrl(
        this.#signer,
        new PutObjectCommand({ Bucket: this.options.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    } catch {
      throw new Error('Storage operation failed');
    }
  }
  async check(): Promise<'up' | 'down'> {
    try {
      await this.#client.send(
        new HeadBucketCommand({ Bucket: this.options.bucket }),
        {
          abortSignal: AbortSignal.timeout(
            this.options.healthTimeoutMs ?? 2000,
          ),
        },
      );
      return 'up';
    } catch {
      return 'down';
    }
  }
  async close(): Promise<void> {
    this.#client.destroy();
    this.#signer.destroy();
  }
}
