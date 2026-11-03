import { z } from 'zod';
import type { CompanionModel, ModelContext } from './CompanionModel.js';
import { buildCompanionPrompt } from './CompanionPrompt.js';

interface Options {
  baseUrl: string;
  apiKey: string;
  model: string;
}

type Fetcher = typeof fetch;

const responseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string() }),
    }),
  ).min(1),
});

const generatedSchema = z.object({
  bubbles: z.array(z.string().trim().min(1).max(500)).min(1).max(3),
});

function normalizeQuestions(bubbles: string[]): string[] {
  let questions = 0;
  return bubbles.map((bubble) =>
    bubble.replace(/[?\uFF1F]/gu, (questionMark) => {
      questions += 1;
      return questions <= 1 ? questionMark : '\u3002';
    }),
  );
}

function parseGeneratedContent(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('model provider returned invalid JSON');
    }
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      throw new Error('model provider returned invalid JSON');
    }
  }
}

export class OpenAICompatibleCompanionModel implements CompanionModel {
  constructor(
    private readonly options: Options,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async generate(context: ModelContext): Promise<string[]> {
    const baseUrl = this.options.baseUrl.replace(/\/$/u, '');
    const prompt = buildCompanionPrompt(context);
    const response = await this.fetcher(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.context },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`model provider failed with HTTP ${response.status}`);
    }

    const provider = responseSchema.parse(await response.json());
    const content = provider.choices[0]?.message.content;
    if (!content) throw new Error('model provider returned an empty message');

    const parsed = parseGeneratedContent(content);

    return normalizeQuestions(generatedSchema.parse(parsed).bubbles);
  }
}
