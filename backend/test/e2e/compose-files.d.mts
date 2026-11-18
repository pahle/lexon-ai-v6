export interface StackDescriptorInput {
  project: string;
  operatorEnvironmentPath: string;
  apiUrl: string;
  publicUrl: string;
  composeFiles: string[];
}
export function buildStackDescriptor(input: StackDescriptorInput): {
  project: string;
  operatorEnvironmentPath: string;
  apiUrl: string;
  publicUrl: string;
  frontendUrl: string;
  composeFiles: string[];
};
export function stackComposeFiles(
  stack: { composeFiles?: string[] },
  repositoryRoot: string,
): string[];
