import { Module } from '@nestjs/common';
import {
  PRODUCTION_ENGINE_REGISTRATIONS,
  RunRegistry,
} from './run-registry.js';

/** Chat is explicitly composed by runtime and evaluation harnesses. */
@Module({
  providers: [
    {
      provide: RunRegistry,
      useFactory: () => {
        const registry = new RunRegistry();
        registry.register(PRODUCTION_ENGINE_REGISTRATIONS);
        return registry;
      },
    },
  ],
  exports: [RunRegistry],
})
export class ChatModule {}
