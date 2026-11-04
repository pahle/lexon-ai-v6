'use client';
import { AuthCard } from './auth-card';
import { Button } from '../ui/button';
export function RecoveryCodes({
  codes,
  onDismiss,
  headingLevel = 2,
  showBrandFooter = true,
}: {
  codes: readonly string[];
  onDismiss: () => void;
  headingLevel?: 1 | 2 | 3;
  showBrandFooter?: boolean;
}) {
  return (
    <AuthCard
      title="Save your recovery codes"
      headingLevel={headingLevel}
      showBrandFooter={showBrandFooter}
      description="Save these codes somewhere secure. Each code can be used once. They will not be shown again."
    >
      <section data-testid="recovery-codes" aria-label="Recovery codes">
        <ul>
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <Button onClick={onDismiss}>I saved my recovery codes</Button>
      </section>
    </AuthCard>
  );
}
