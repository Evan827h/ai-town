/**
 * Core type definitions for the psyche registry system.
 *
 * The engine is generic — it iterates over whatever entries exist in registries.
 * New world systems (economy, jobs, class) add data to registries, not logic to the engine.
 */

export interface NeedDefinition {
  id: string;
  name: string;
  maxValue: number;
  /** Units lost per game-minute */
  depletionRate: number;
  /** How much this need matters relative to others (1.0 = baseline) */
  priorityWeight: number;
  /** Below this value, urgency gets a 3x multiplier */
  criticalThreshold: number;
}

export interface AgentNeedState {
  needId: string;
  currentValue: number;
  lastUpdated: number; // game-time timestamp
}

export interface ActionEffect {
  needId: string;
  /** Positive = replenish, negative = cost */
  amount: number;
}

export interface ActionRequirement {
  type: 'location' | 'resource' | 'state';
  target: string;
  value?: string | number;
}

export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  /** If set, agent must be at this location type to perform action */
  locationRequirement?: string;
  /** How long the action takes in game-minutes */
  duration: number;
  /** Needs this action replenishes */
  replenishes: ActionEffect[];
  /** Needs this action costs (depletes) */
  costs: ActionEffect[];
  /** Conditions that must be met */
  requires?: ActionRequirement[];
}

export interface ScoredAction {
  action: ActionDefinition;
  score: number;
}

// Registry containers — simple Maps, not database rows
export type NeedRegistry = Map<string, NeedDefinition>;
export type ActionRegistry = Map<string, ActionDefinition>;
