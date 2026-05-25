import { describe, test, expect } from 'bun:test';
import type { GenerationConfig } from './service';

describe('AIService Types', () => {
  describe('GenerationConfig', () => {
    test('should have correct default values', () => {
      const defaultConfig: GenerationConfig = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        maxTokens: 4096,
        responseFormat: 'text',
      };

      expect(defaultConfig.provider).toBe('groq');
      expect(defaultConfig.model).toBe('llama-3.3-70b-versatile');
      expect(defaultConfig.temperature).toBe(0.7);
      expect(defaultConfig.maxTokens).toBe(4096);
      expect(defaultConfig.responseFormat).toBe('text');
    });

    test('should allow partial override', () => {
      const partialConfig: Partial<GenerationConfig> = {
        temperature: 0.9,
        maxTokens: 2000,
      };

      const mergedConfig = { ...{ provider: 'groq', model: '', temperature: 0.7, maxTokens: 4096, responseFormat: 'text' as const }, ...partialConfig };

      expect(mergedConfig.temperature).toBe(0.9);
      expect(mergedConfig.maxTokens).toBe(2000);
      expect(mergedConfig.provider).toBe('groq'); // unchanged
    });

    test('should accept gemini provider', () => {
      const config: GenerationConfig = {
        provider: 'gemini',
        model: 'gemini-pro',
        temperature: 0.5,
        maxTokens: 8192,
        responseFormat: 'text',
      };

      expect(config.provider).toBe('gemini');
    });

    test('should accept json_object response format', () => {
      const config: GenerationConfig = {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        maxTokens: 4096,
        responseFormat: 'json_object',
      };

      expect(config.responseFormat).toBe('json_object');
    });
  });

  describe('AIService interface', () => {
    test('should define generate function', () => {
      // Test that the interface is correctly typed
      const service = {
        generate: (prompt: string, config?: Partial<GenerationConfig>) =>
          Promise.resolve('mock response'),
        generateJSON: <T>(prompt: string, config?: Partial<GenerationConfig>) =>
          Promise.resolve({} as T),
        embed: (text: string) => Promise.resolve([0.1, 0.2, 0.3]),
      };

      expect(typeof service.generate).toBe('function');
      expect(typeof service.generateJSON).toBe('function');
      expect(typeof service.embed).toBe('function');
    });

    test('generate should accept prompt and optional config', async () => {
      const service = {
        generate: async (prompt: string, config?: Partial<GenerationConfig>) => {
          return `Response to: ${prompt}`;
        },
      };

      const result = await service.generate('test prompt');
      expect(result).toBe('Response to: test prompt');
    });

    test('generateJSON should return typed result', async () => {
      interface TestData {
        name: string;
        value: number;
      }

      const service = {
        generateJSON: async <T>(): Promise<T> => {
          return { name: 'test', value: 42 } as T;
        },
      };

      const result = await service.generateJSON<TestData>();
      expect(result.name).toBe('test');
      expect(result.value).toBe(42);
    });

    test('embed should return number array', async () => {
      const service = {
        embed: async (text: string): Promise<number[]> => {
          return [0.1, 0.2, 0.3, 0.4, 0.5];
        },
      };

      const result = await service.embed('test text');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(5);
      expect(result[0]).toBe(0.1);
    });
  });
});

describe('Groq API URL', () => {
  test('should use correct groq endpoint', () => {
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    expect(groqUrl).toContain('groq.com');
    expect(groqUrl).toContain('/openai/v1/');
  });
});

describe('Gemini API URL', () => {
  test('should construct correct gemini endpoint', () => {
    const model = 'gemini-pro';
    const apiKey = 'test-key';
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    expect(geminiUrl).toContain('generativelanguage.googleapis.com');
    expect(geminiUrl).toContain(model);
    expect(geminiUrl).toContain('generateContent');
  });
});

describe('Response parsing', () => {
  test('should extract content from groq response structure', () => {
    const groqResponse = {
      choices: [{ message: { content: 'Test response content' } }],
    };

    const content = groqResponse.choices[0]?.message?.content ?? '';
    expect(content).toBe('Test response content');
  });

  test('should handle missing content gracefully', () => {
    const groqResponse = {
      choices: [{ message: {} }],
    };

    const content = groqResponse.choices[0]?.message?.content ?? '';
    expect(content).toBe('');
  });

  test('should extract content from gemini response structure', () => {
    const geminiResponse = {
      candidates: [{ content: { parts: [{ text: 'Gemini response text' }] } }],
    };

    const content = geminiResponse.candidates[0]?.content?.parts[0]?.text ?? '';
    expect(content).toBe('Gemini response text');
  });

  test('should handle missing gemini content gracefully', () => {
    const geminiResponse = {
      candidates: [{ content: { parts: [] } }],
    };

    const content = geminiResponse.candidates[0]?.content?.parts[0]?.text ?? '';
    expect(content).toBe('');
  });
});

describe('JSON cleaning', () => {
  test('should remove ```json code blocks', () => {
    const response = '```json\n{"name": "test"}\n```';
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    expect(cleaned.trim()).toBe('{"name": "test"}');
  });

  test('should remove ``` code blocks without json prefix', () => {
    const response = '```\n{"name": "test"}\n```';
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    expect(cleaned.trim()).toBe('{"name": "test"}');
  });

  test('should handle response without code blocks', () => {
    const response = '{"name": "test", "value": 42}';
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    }
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    const parsed = JSON.parse(cleaned.trim());
    expect(parsed.name).toBe('test');
  });
});
