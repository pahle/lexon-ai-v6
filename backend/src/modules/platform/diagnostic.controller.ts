import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  DiagnosticInputSchema,
  type DiagnosticInput,
  type DiagnosticResponse,
} from '@lexon/contracts';
@Controller('diagnostics')
export class DiagnosticController {
  @Post('validation')
  @HttpCode(200)
  validate(
    @Body({ schema: DiagnosticInputSchema }) input: DiagnosticInput,
  ): DiagnosticResponse {
    return { probeId: input.probeId, accepted: true };
  }
}
