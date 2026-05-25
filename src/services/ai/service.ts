interface GenerationConfig {
  provider: 'groq' | 'gemini';
  model: string;
  temperature: number;
  maxTokens: number;
  responseFormat?: 'text' | 'json_object';
}

interface AIService {
  generate(prompt: string, config?: Partial<GenerationConfig>): Promise<string>;
  generateJSON<T>(prompt: string, config?: Partial<GenerationConfig>): Promise<T>;
  embed(text: string): Promise<number[]>;
}

const DEFAULT_CONFIG: GenerationConfig = {
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  temperature: 0.7,
  maxTokens: 4096,
  responseFormat: 'text',
};

async function callGroq(prompt: string, config: GenerationConfig): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: config.responseFormat === 'json_object' ? { type: 'json_object' } : undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

async function callGemini(prompt: string, config: GenerationConfig): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: config.temperature,
          maxOutputTokens: config.maxTokens,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return data.candidates[0]?.content?.parts[0]?.text ?? '';
}

export const AIService: AIService = {
  async generate(prompt: string, config?: Partial<GenerationConfig>): Promise<string> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (mergedConfig.provider === 'gemini') {
      return callGemini(prompt, mergedConfig);
    }
    return callGroq(prompt, mergedConfig);
  },

  async generateJSON<T>(prompt: string, config?: Partial<GenerationConfig>): Promise<T> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config, responseFormat: 'json_object' as const };

    const jsonPrompt = prompt + '\nYou MUST respond ONLY with valid JSON. No explanation, no markdown formatting.';

    try {
      const response = await this.generate(jsonPrompt, mergedConfig);
      // Clean the response - remove markdown code blocks if present
      let cleanedResponse = response.trim();
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.slice(7);
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      return JSON.parse(cleanedResponse.trim()) as T;
    } catch (error) {
      // Retry once on parse failure
      console.warn('JSON parsing failed, retrying once...');
      const response = await this.generate(jsonPrompt, mergedConfig);
      let cleanedResponse = response.trim();
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.slice(7);
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      return JSON.parse(cleanedResponse.trim()) as T;
    }
  },

  async embed(text: string): Promise<number[]> {
    // Dynamic import to handle transformers.js
    const { pipeline } = await import('@xenova/transformers');

    // Use bge-small-en-v1.5 model for embeddings
    const embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');

    const result = await embedder(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Convert tensor to array if needed
    if (result && typeof result === 'object' && 'data' in result) {
      return Array.from(result.data as Iterable<number>);
    }
    return Array.from(result as Iterable<number>);
  },
};

export interface EEATScore {
  experience: number;
  expertise: number;
  authoritativeness: number;
  trustworthiness: number;
  overall: number;
}

export interface InfoGainCheck {
  passed: boolean;
  elementsFound: string[];
  missingElements: string[];
}

export interface GenerationInput {
  keywords: string[];
  primaryEntitySlug: string;
  styleTemplateId: string;
  targetWordCount: number;
  contentType: 'article' | 'review' | 'comparison' | 'guide';
}

export interface GenerationOutput {
  title: string;
  slug: string;
  outline: string[];
  facts: Record<string, string>;
  draftMd: string;
  humanizedMd: string;
  seoEnhancedHtml: string;
  eeatSelfScore: EEATScore;
  infoGainCheck: InfoGainCheck;
}

export interface EntityWithAllData {
  id: number;
  name: string;
  slug: string;
  type: string;
  description: string | null;
  attributes: Record<string, string>;
  relations: Array<{ predicate: string; entity: { id: number; name: string; slug: string } }>;
}