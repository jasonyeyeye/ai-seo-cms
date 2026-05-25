import { readFileSync } from 'fs';
import { join } from 'path';
import { db } from '../../db';
import { suggestions, posts } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { executeSuggestion } from './execution-engine';

export interface Rule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export interface RuleCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'in';
  value: string | number | string[];
}

export interface RuleAction {
  type: 'approve' | 'reject' | 'execute' | 'tag';
  value?: string;
}

// Load rules from config file
function loadRules(): Rule[] {
  try {
    const rulesPath = join(process.cwd(), 'config/auto-rules.json');
    const content = readFileSync(rulesPath, 'utf-8');
    return JSON.parse(content) as Rule[];
  } catch (error) {
    console.warn('Failed to load auto-rules.json, using defaults:', error);
    return getDefaultRules();
  }
}

// Default rules if config file doesn't exist
function getDefaultRules(): Rule[] {
  return [
    {
      id: 'auto-approve-high-quality',
      name: 'Auto-Approve High Quality',
      description: 'Automatically approve suggestions from E-E-A-T scorer with score >= 8',
      enabled: false,
      conditions: [
        { field: 'source', operator: 'equals', value: 'eeat_scorer' },
        { field: 'payload.eeatScore.overall', operator: 'greater_than', value: 7 },
      ],
      actions: [
        { type: 'approve' },
      ],
    },
    {
      id: 'auto-reject-budget-warning',
      name: 'Auto-Reject Budget Warnings',
      description: 'Automatically reject budget warning suggestions (informational only)',
      enabled: false,
      conditions: [
        { field: 'type', operator: 'equals', value: 'budget_warning' },
      ],
      actions: [
        { type: 'reject' },
      ],
    },
    {
      id: 'auto-tag-cannibalization',
      name: 'Tag Cannibalization',
      description: 'Add tag to cannibalization suggestions for priority review',
      enabled: false,
      conditions: [
        { field: 'type', operator: 'equals', value: 'cannibalization' },
      ],
      actions: [
        { type: 'tag', value: 'priority-review' },
      ],
    },
  ];
}

// Evaluate a single condition against a suggestion
function evaluateCondition(suggestion: Record<string, unknown>, condition: RuleCondition): boolean {
  const fieldValue = getNestedValue(suggestion, condition.field);

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'contains':
      return typeof fieldValue === 'string' && fieldValue.includes(condition.value as string);
    case 'greater_than':
      return typeof fieldValue === 'number' && fieldValue > (condition.value as number);
    case 'less_than':
      return typeof fieldValue === 'number' && fieldValue < (condition.value as number);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue as string);
    default:
      return false;
  }
}

// Get nested value from object using dot notation
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// Evaluate all conditions for a rule
function evaluateRule(rule: Rule, suggestion: Record<string, unknown>): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;

  return rule.conditions.every(condition =>
    evaluateCondition(suggestion, condition)
  );
}

// Apply actions for a matched rule
async function applyActions(actions: RuleAction[], suggestionId: number): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'approve':
        await db.update(suggestions)
          .set({ status: 'approved' })
          .where(eq(suggestions.id, suggestionId));
        break;
      case 'reject':
        await db.update(suggestions)
          .set({ status: 'rejected' })
          .where(eq(suggestions.id, suggestionId));
        break;
      case 'execute':
        await executeSuggestion(suggestionId);
        break;
      case 'tag':
        // Tags would be stored in a separate table or as part of payload
        // For now, just log it
        console.log(`Tag ${action.value} applied to suggestion ${suggestionId}`);
        break;
    }
  }
}

// Main evaluation and execution function
export async function evaluateAndExecute(): Promise<{
  processed: number;
  matched: number;
  results: Array<{ ruleId: string; suggestionId: number; actions: string[] }>;
}> {
  const rules = loadRules();
  const results: Array<{ ruleId: string; suggestionId: number; actions: string[] }> = [];

  // Get all pending suggestions
  const pendingSuggestions = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.status, 'pending'))
    .orderBy(desc(suggestions.createdAt))
    .limit(100);

  for (const suggestion of pendingSuggestions) {
    const suggestionObj = {
      ...suggestion,
      payload: JSON.parse(suggestion.payload as string),
    };

    for (const rule of rules) {
      if (evaluateRule(rule, suggestionObj)) {
        await applyActions(rule.actions, suggestion.id);
        results.push({
          ruleId: rule.id,
          suggestionId: suggestion.id,
          actions: rule.actions.map(a => a.type),
        });
      }
    }
  }

  return {
    processed: pendingSuggestions.length,
    matched: results.length,
    results,
  };
}

// Get all rules
export function getRules(): Rule[] {
  return loadRules();
}

// Update a rule's enabled status
export function updateRuleEnabled(ruleId: string, enabled: boolean): boolean {
  const rules = loadRules();
  const rule = rules.find(r => r.id === ruleId);

  if (!rule) return false;

  rule.enabled = enabled;
  saveRules(rules);
  return true;
}

// Save rules to config file
function saveRules(rules: Rule[]): void {
  try {
    const rulesPath = join(process.cwd(), 'config/auto-rules.json');
    const content = JSON.stringify(rules, null, 2);
    // Note: In production, you'd want to write atomically
    // For now, this is a placeholder - actual file writing would need fs promises
    console.log('Rules updated (save not implemented):', rules);
  } catch (error) {
    console.error('Failed to save rules:', error);
  }
}

// Initialize default rules file if it doesn't exist
export function initializeRulesFile(): void {
  try {
    const rulesPath = join(process.cwd(), 'config/auto-rules.json');
    const content = readFileSync(rulesPath, 'utf-8');
    JSON.parse(content); // Validate JSON
  } catch {
    // File doesn't exist or is invalid, create with defaults
    const rules = getDefaultRules();
    console.log('Initializing auto-rules.json with defaults');
    // Note: Actual file creation would use fs promises in production
  }
}
