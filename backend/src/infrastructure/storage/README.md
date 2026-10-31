# Storage boundary

Application code depends on `StoragePort`; AWS SDK v3 and S3 endpoint details
stay inside this adapter. The pinned SeaweedFS gateway is verified with binary
put/get/delete, exact inclusive ranges, and an HTTP presigned PUT. Tampering
with the signature is rejected. Errors expose fixed messages only, without
SDK causes, object keys, credentials, endpoint hosts or signed URLs.

`S3_ENDPOINT` reaches the service from the backend. `S3_PUBLIC_ENDPOINT`, when
set, is used only for presigning and must be reachable from the upload caller.
It defaults to the internal endpoint for local tests. Merely rewriting a
signed URL after signing invalidates its signature.

The SDK's normal uploads retain default checksum behavior. The separate
presigning client uses `requestChecksumCalculation: WHEN_REQUIRED`: its input
has no upload body yet, and a default CRC32 for that empty input would reject
later nonempty uploads with BadDigest. URL expiration is an integer from one
second to seven days. Signed URLs are credentials and must never be logged.

Readiness uses bounded, non-destructive `HeadBucket` access. It returns only
up/down, requires bucket access and never creates an object. Client instances
are explicitly closed at shutdown. F7 can wrap or extend this port with the
approved encryption scheme; F0 introduces no encryption or document pipeline.
