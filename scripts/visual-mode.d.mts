export type VisualMode = 'capture' | 'compare' | 'update';
export function resolveVisualMode(options?: {
  explicitMode?: string;
  approvalPath?: string;
  updateSnapshots?: boolean;
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
  options: { mode: VisualMode; baselineDirectory?: string },
): string;
