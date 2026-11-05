import type { ModelEvent, ModelGateway } from '../model-contracts.js';

export interface ModelScript {
  readonly events: readonly ModelEvent[];
}

export function createScriptedModelGateway(
  scripts: readonly ModelScript[],
): ModelGateway {
  let nextScript = 0;
  return {
    generate() {
      const script = scripts[nextScript++];
      if (!script) throw new Error('No scripted model response remains');
      return scriptedEvents(script.events);
    },
  };
}

async function* scriptedEvents(
  events: readonly ModelEvent[],
): AsyncGenerator<ModelEvent> {
  for (const event of events) yield event;
}
