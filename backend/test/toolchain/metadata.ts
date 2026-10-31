import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';

@Injectable()
class Dependency {
  readonly value = 'lexon-esm-metadata';
}

@Injectable()
class Consumer {
  constructor(readonly dependency: Dependency) {}
}

export async function inspectMetadata(): Promise<string> {
  const context = await Test.createTestingModule({
    providers: [Dependency, Consumer],
  }).compile();
  try {
    return context.get(Consumer).dependency.value;
  } finally {
    await context.close();
  }
}
