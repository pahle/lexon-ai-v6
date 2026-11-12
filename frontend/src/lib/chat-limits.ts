export const MAX_PROMPT_BYTES = 16_384;
export const promptByteLength = (text: string) =>
  new TextEncoder().encode(text).byteLength;
