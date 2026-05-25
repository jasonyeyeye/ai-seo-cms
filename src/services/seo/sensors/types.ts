export interface Suggestion {
  type: string;
  targetType: 'post' | 'topic' | 'entity';
  targetId: number;
  payload: Record<string, unknown>;
  source: string;
}

export type SensorModule = {
  name: string;
  source: string;
  description: string;
  enabled: boolean;
  execute: () => Promise<Suggestion[]>;
};
