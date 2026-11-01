import { EmailAddressSchema } from '@lexon/contracts';
export interface SetupAdmissionFacts {
  email: string;
  additional: boolean;
  adminExists: boolean;
  pendingInitialEmail: string | null;
  existingPending: boolean;
}
export function decideAdminSetup(
  input: SetupAdmissionFacts,
): 'created' | 'pending' | 'refused' {
  if (
    !input.additional &&
    (input.adminExists ||
      (input.pendingInitialEmail !== null &&
        input.pendingInitialEmail !== input.email))
  )
    return 'refused';
  return input.existingPending ? 'pending' : 'created';
}
export function parseAdminSetupArgs(args: readonly string[]): {
  email: string;
  additional: boolean;
} {
  let email: string | undefined;
  let additional = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (
      argument === '--email' &&
      email === undefined &&
      args[index + 1] !== undefined
    )
      email = args[++index];
    else if (argument === '--additional' && !additional) additional = true;
    else throw new Error('Invalid setup arguments');
  }
  const parsed = EmailAddressSchema.safeParse(email);
  if (!parsed.success) throw new Error('Invalid setup arguments');
  return { email: parsed.data, additional };
}
