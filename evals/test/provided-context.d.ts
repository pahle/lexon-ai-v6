import 'vitest';

declare module 'vitest' {
  interface ProvidedContext {
    evaluationServices: import('@lexon/backend/evaluation').EvaluationServices;
  }
}
