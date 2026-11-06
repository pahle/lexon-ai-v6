import type {
  ContextProvider,
  EngineRegistrations,
  RunProfile,
  ToolDefinition,
} from './run-contracts.js';
import {
  DEFAULT_MAX_ATTEMPTS_PER_STEP,
  RUN_REGISTRATION_LIMITS,
} from './run-contracts.js';

export const PRODUCTION_ENGINE_REGISTRATIONS: EngineRegistrations =
  Object.freeze({
    profiles: Object.freeze([]),
    contexts: Object.freeze([]),
    tools: Object.freeze([]),
  });

export class RunRegistry {
  readonly #profiles = new Map<string, RunProfile>();
  readonly #contexts = new Map<string, ContextProvider>();
  readonly #tools = new Map<string, ToolDefinition>();

  register(registrations: EngineRegistrations): void {
    const profiles = new Map(this.#profiles);
    const contexts = new Map(this.#contexts);
    const tools = new Map(this.#tools);

    for (const profile of registrations.profiles) {
      if (profiles.has(profile.id)) throw new Error('Duplicate run profile id');
      validateProfile(profile);
      profiles.set(profile.id, profile);
    }
    for (const context of registrations.contexts) {
      if (contexts.has(context.id))
        throw new Error('Duplicate context provider id');
      if (
        !context.id.trim() ||
        !Number.isInteger(context.version) ||
        context.version < 1 ||
        typeof context.collect !== 'function'
      )
        throw new Error('Invalid context provider');
      contexts.set(context.id, context);
    }
    for (const tool of registrations.tools) {
      if (tools.has(tool.id)) throw new Error('Duplicate tool id');
      tools.set(tool.id, tool);
    }
    for (const tool of tools.values()) validateTool(tool, profiles);

    this.#profiles.clear();
    this.#contexts.clear();
    this.#tools.clear();
    for (const [id, profile] of profiles) this.#profiles.set(id, profile);
    for (const [id, context] of contexts) this.#contexts.set(id, context);
    for (const [id, tool] of tools) this.#tools.set(id, tool);
  }

  profile(id: string): RunProfile | undefined {
    return this.#profiles.get(id);
  }

  context(id: string): ContextProvider | undefined {
    return this.#contexts.get(id);
  }

  tool(id: string): ToolDefinition | undefined {
    return this.#tools.get(id);
  }

  tools(): readonly ToolDefinition[] {
    return [...this.#tools.values()];
  }
}

function validateProfile(profile: RunProfile): void {
  if (
    !profile.id.trim() ||
    !Number.isInteger(profile.version) ||
    profile.version < 1
  )
    throw new Error('Invalid run profile identity');
  if (
    !profile.allowedModels.length ||
    !profile.allowedModels.includes(profile.defaultModel)
  )
    throw new Error('Default model must be allowed');
  if (
    profile.allowedModels.some((model) => !model.trim()) ||
    (profile.queue !== 'ai-interactive' && profile.queue !== 'ai-batch')
  )
    throw new Error('Invalid run profile model or queue');
  for (const value of [
    profile.priority,
    profile.maxIterations,
    profile.tokenBudget,
    profile.maxOutputTokens,
    profile.maxAttemptsPerStep ?? DEFAULT_MAX_ATTEMPTS_PER_STEP,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Invalid run profile limit');
  }
  if (profile.maxOutputTokens > profile.tokenBudget)
    throw new Error('Output exceeds token budget');
  for (const budget of Object.values(profile.contextBudgets)) {
    if (!Number.isSafeInteger(budget) || budget < 0)
      throw new Error('Invalid context budget');
  }
  for (const value of [
    profile.maxToolInputBytes,
    profile.maxToolResultBytes,
    profile.maxToolTimeoutMs,
  ]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1))
      throw new Error('Invalid tool limit');
  }
  if (
    (profile.maxToolInputBytes ?? RUN_REGISTRATION_LIMITS.maxInputBytes) >
      RUN_REGISTRATION_LIMITS.maxInputBytes ||
    (profile.maxToolResultBytes ?? RUN_REGISTRATION_LIMITS.maxResultBytes) >
      RUN_REGISTRATION_LIMITS.maxResultBytes ||
    (profile.maxToolTimeoutMs ?? RUN_REGISTRATION_LIMITS.maxTimeoutMs) >
      RUN_REGISTRATION_LIMITS.maxTimeoutMs
  )
    throw new Error('Run profile exceeds configured tool limits');
  if (
    profile.childBounds &&
    (!Number.isSafeInteger(profile.childBounds.maxDepth) ||
      profile.childBounds.maxDepth < 1 ||
      !Number.isSafeInteger(profile.childBounds.tokenBudget) ||
      profile.childBounds.tokenBudget < 1)
  )
    throw new Error('Invalid child bounds');
}

function validateTool(
  tool: ToolDefinition,
  profiles: ReadonlyMap<string, RunProfile>,
): void {
  if (
    !tool.id.trim() ||
    !Number.isInteger(tool.version) ||
    tool.version < 1 ||
    typeof tool.inputSchema?.safeParse !== 'function' ||
    typeof tool.requiresApproval !== 'boolean' ||
    !Array.isArray(tool.capabilities) ||
    tool.capabilities.some((capability) => !capability.trim())
  )
    throw new Error('Invalid tool identity');
  if (
    !Number.isSafeInteger(tool.timeoutMs) ||
    tool.timeoutMs < 1 ||
    tool.timeoutMs > RUN_REGISTRATION_LIMITS.maxTimeoutMs
  )
    throw new Error('Tool timeout exceeds configured maximum');
  const maxInputBytes =
    tool.maxInputBytes ?? RUN_REGISTRATION_LIMITS.maxInputBytes;
  if (
    !Number.isSafeInteger(maxInputBytes) ||
    maxInputBytes < 1 ||
    maxInputBytes > RUN_REGISTRATION_LIMITS.maxInputBytes
  )
    throw new Error('Tool input exceeds configured maximum');
  if (
    !Number.isSafeInteger(tool.maxResultBytes) ||
    tool.maxResultBytes < 1 ||
    tool.maxResultBytes > RUN_REGISTRATION_LIMITS.maxResultBytes
  )
    throw new Error('Tool result exceeds configured maximum');
  for (const profile of profiles.values()) {
    if (
      tool.timeoutMs >
        (profile.maxToolTimeoutMs ?? RUN_REGISTRATION_LIMITS.maxTimeoutMs) ||
      maxInputBytes >
        (profile.maxToolInputBytes ?? RUN_REGISTRATION_LIMITS.maxInputBytes) ||
      tool.maxResultBytes >
        (profile.maxToolResultBytes ?? RUN_REGISTRATION_LIMITS.maxResultBytes)
    )
      throw new Error('Tool exceeds a registered profile limit');
  }
  if (tool.kind === 'write') {
    if (!tool.idempotency)
      throw new Error('Write tool requires an idempotency mode');
    switch (tool.idempotency.mode) {
      case 'transactional':
        if (!('execute' in tool) || typeof tool.execute !== 'function')
          throw new Error('Transactional mode requires an execution callback');
        break;
      case 'idempotency-key':
        if (
          !('executeExternal' in tool) ||
          typeof tool.executeExternal !== 'function'
        )
          throw new Error(
            'Idempotency-key mode requires an external execution callback',
          );
        throw new Error('Unsupported external write adapter in F3');
      case 'reconcile':
        if (
          !('executeExternal' in tool) ||
          typeof tool.executeExternal !== 'function' ||
          !('reconcile' in tool) ||
          typeof tool.reconcile !== 'function'
        )
          throw new Error(
            'Reconcile mode requires execution and reconciliation callbacks',
          );
        throw new Error('Unsupported external write adapter in F3');
      default:
        throw new Error('Unsupported write idempotency mode');
    }
  } else if (tool.kind !== 'read' || typeof tool.execute !== 'function') {
    throw new Error('Read tool requires an execution callback');
  }
}
