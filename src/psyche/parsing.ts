import { InteractionOutcome } from './registries';

/** Valid outcomes the LLM can classify a conversation as */
const VALID_OUTCOMES: Set<InteractionOutcome> = new Set([
  'positive_social',
  'negative_social',
  'helpful',
  'betrayal',
  'impressive',
  'neutral',
]);

/**
 * Parse an OUTCOME: label from LLM conversation summary output.
 * Returns the cleaned text (label stripped) and the parsed outcome.
 * Falls back to 'positive_social' if no valid outcome is found.
 */
export function parseConversationOutcome(llmOutput: string): {
  cleanText: string;
  outcome: InteractionOutcome;
} {
  const pattern = /\n?\s*OUTCOME:\s*(\S+)\s*$/i;
  const match = llmOutput.match(pattern);

  if (match) {
    const candidate = match[1].toLowerCase() as InteractionOutcome;
    if (VALID_OUTCOMES.has(candidate)) {
      return {
        cleanText: llmOutput.replace(pattern, '').trim(),
        outcome: candidate,
      };
    }
  }

  return {
    cleanText: llmOutput.trim(),
    outcome: 'positive_social',
  };
}
