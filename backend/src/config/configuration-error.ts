export class RuntimeConfigurationError extends Error {
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) {
    super(`Invalid configuration: ${fields.join(', ')}`);
    this.fields = Object.freeze([...fields]);
  }
}
