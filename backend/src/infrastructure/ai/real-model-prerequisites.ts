export interface RealModelPrerequisites {
  readonly verifiedOn: string;
}

const REJECTION =
  'Real model access requires a valid dated ZDR-only account attestation, an operator-configured key credit limit, excluded Safety Retention, and disabled prompt/response logging before setting the attestation.';

export function validateRealModelPrerequisites(
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): RealModelPrerequisites {
  const date = env.LEXON_OPENROUTER_ZDR_ONLY_VERIFIED;
  if (
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) ||
    new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date ||
    new Date(`${date}T00:00:00.000Z`).getTime() > now.getTime()
  ) {
    throw new Error(REJECTION);
  }
  return { verifiedOn: date };
}
