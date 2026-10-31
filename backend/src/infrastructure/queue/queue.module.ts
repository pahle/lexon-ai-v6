import { Module, type DynamicModule } from '@nestjs/common';
import { QueueProducer, type QueueOptions } from './queue-producer.js';
@Module({})
export class QueueModule {
  static forProducer(options: QueueOptions): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: QueueProducer,
          useFactory: () => new QueueProducer(options),
        },
      ],
      exports: [QueueProducer],
    };
  }
}
