export type VisualMode = 'capture' | 'compare' | 'update';
export type VisualIndex = {
  version: number;
  format: string;
  deviceScaleFactor: number;
  viewports: Record<string, { width: number; height: number }>;
  views: Record<
    string,
    {
      path: string;
      viewport: string;
      theme?: string;
      state?: string;
      source?: string;
      applicability?: string;
    }
  >;
};
export type ApprovedVisualImage = {
  path: string;
  sha256: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
};
export type VisualRetirementRecord = {
  version: 1;
  status: 'approved';
  ownerApproval: { reference: string; date: string };
  replacementSlice: 'F4.1';
  images: {
    id: string;
    baselineSha256: string;
    reason: string;
    diff: string;
    checkedRegions: { name: string; rect: [number, number, number, number] }[];
    outsideApprovedRegions: 0;
  }[];
};
export type ApprovedVisualRecord = {
  version: 1;
  status: 'approved';
  sourceSha: string;
  ownerApproval: { reference: string; date: string };
  environment: {
    os: string;
    browser: string;
    playwright: string;
    node: string;
    locale: string;
    timezone: string;
  };
  originalApproval?: {
    sourceSha: string;
    manifestCommit: string;
    reference: string;
    date: string;
  };
  amendments?: {
    reference: string;
    date: string;
    sourceSha: string;
    viewIds: string[];
    description?: string;
  }[];
  images: Record<string, ApprovedVisualImage>;
};
export type VisualBaselineManifest = {
  version: 1;
  sourceSha: string;
  generatedAt: string;
  approvalSha256: string;
  indexSha256: string;
  environment: Record<string, string>;
  viewCount: number;
  images: Record<string, ApprovedVisualImage>;
};
export function isSnapshotUpdateEnabled(
  updateSnapshots: 'all' | 'changed' | 'missing' | 'none' | 'default',
): boolean;
export function resolveVisualMode(options?: {
  explicitMode?: string;
  approvalPath?: string;
  updateSnapshots?: boolean;
  runtime?: { ci: boolean; platform: string };
}): VisualMode;
export function assertReviewArtifact(
  index: { views?: Record<string, { path: string }> },
  id: string,
  directory: string,
): string;
export function assertIndexedArtifact(
  index: { views?: Record<string, { path: string }> },
  id: string,
  directory: string,
  options: {
    mode: VisualMode;
    baselineDirectory?: string;
    retirements?: VisualRetirementRecord;
  },
): string | null;
export function assertApprovedVisualSet(
  index: VisualIndex,
  approval: ApprovedVisualRecord,
  directory: string,
  options?: { requireBaselines?: boolean; expectedViewCount?: number },
): number;
export function buildVisualBaselineManifest(
  index: VisualIndex,
  approval: ApprovedVisualRecord,
  directory: string,
  options: {
    sourceSha: string;
    environment: Record<string, string>;
    generatedAt?: string;
    approvalSha256?: string;
    indexSha256?: string;
    expectedViewCount?: number;
  },
): VisualBaselineManifest;
