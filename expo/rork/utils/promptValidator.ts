export interface PromptValidationResult {
  readonly isWithinLimit: boolean;
  readonly promptToSend: string;
  readonly originalTokenEstimate: number;
  readonly maxTokens: number;
}

const TOKEN_ESTIMATE_DIVISOR = 4;

export function validatePromptLength(prompt: string, maxTokens: number): PromptValidationResult {
  const safePrompt = prompt ?? '';
  const estimatedTokens = Math.ceil(safePrompt.length / TOKEN_ESTIMATE_DIVISOR);

  if (estimatedTokens <= maxTokens) {
    return {
      isWithinLimit: true,
      promptToSend: safePrompt,
      originalTokenEstimate: estimatedTokens,
      maxTokens,
    };
  }

  const maxCharacters = maxTokens * TOKEN_ESTIMATE_DIVISOR;
  const truncatedPrompt = `${safePrompt.slice(0, Math.max(0, maxCharacters - 3))}...`;

  return {
    isWithinLimit: false,
    promptToSend: truncatedPrompt,
    originalTokenEstimate: estimatedTokens,
    maxTokens,
  };
}
