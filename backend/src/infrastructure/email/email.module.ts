import { Module, type DynamicModule } from '@nestjs/common';
import { EMAIL_PORT } from './email-port.js';
import { SmtpMailer } from './smtp-mailer.js';

@Module({})
export class EmailModule {
  static forOptions(options: {
    origin: string;
    from: string;
    url: string;
  }): DynamicModule {
    return {
      module: EmailModule,
      providers: [
        { provide: EMAIL_PORT, useFactory: () => new SmtpMailer(options) },
      ],
      exports: [EMAIL_PORT],
    };
  }
}
