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
  /** Which relationship dimensions matter for this action (weights sum to ~1.0) */
  socialWeights?: SocialWeights;
  moralCosts?: MoralTag[];
}

export interface ScoredAction {
  action: ActionDefinition;
  score: number;
}

// ─── Relationship Graph Types ────────────────────────────────

export interface SocialWeights {
  trust?: number;
  affinity?: number;
  respect?: number;
  frequency?: number;
  familiarity?: number;
}

/** Directed, weighted edge between two agents */
export interface RelationshipEdge {
  fromAgentId: string;
  toAgentId: string;
  /** How much the agent trusts the other (-100..100) */
  trust: number;
  /** How much the agent likes the other (-100..100) */
  affinity: number;
  /** How much the agent respects the other (-100..100) */
  respect: number;
  /** How often they interact — decays over time (0..100) */
  frequency: number;
  /** How well they know each other — only grows (0..100) */
  familiarity: number;
  /** Timestamp of last interaction (game-time) */
  lastInteraction: number;
}

/** Default attitudes a character has toward strangers */
export interface SocialDisposition {
  defaultTrust: number;
  defaultAffinity: number;
  defaultRespect: number;
}

/** Outcome types that can result from an interaction */
export type InteractionOutcome =
  | 'positive_social'
  | 'negative_social'
  | 'helpful'
  | 'betrayal'
  | 'impressive'
  | 'neutral';

// ─── Moral Compass Types ─────────────────────────────────────

export interface MoralValue {
  id: string;
  name: string;
  description: string;
}

/** Per-character moral profile — weights 0..1 for each moral value */
export interface MoralProfile {
  /**
   * moral value ID → importance weight (0..1, inclusive).
   * Values outside this range are NOT clamped by the scorer
   * and will produce effectiveSeverity values that break threshold logic.
   */
  weights: Record<string, number>;
  /** effectiveSeverity >= this → action is hard-vetoed (removed from options) */
  hardVetoThreshold: number;
  /** totalPenalty > this → flag internal conflict */
  conflictThreshold: number;
}

/** Moral cost attached to an action — how much it violates a value */
export interface MoralTag {
  /** ID of the moral value being violated (must exist in MORAL_VALUES registry) */
  moralValueId: string;
  /** 0..1, base severity before weighting by character profile. Not clamped by the scorer — caller is responsible for valid range. */
  severity: number;
}

// ─── Opinion Tracking Types ──────────────────────────────────

export interface OpinionTopic {
  id: string;
  name: string;
  description: string;
}

export interface AgentOpinion {
  topicId: string;
  /** 0 = strongly opposed, 5 = neutral, 10 = strongly supportive */
  value: number;
  lastUpdated: number;
}

export interface OpinionDelta {
  topicId: string;
  /** Positive = more favorable, negative = less favorable */
  delta: number;
}

// Registry containers — simple Maps, not database rows
export type NeedRegistry = Map<string, NeedDefinition>;
export type ActionRegistry = Map<string, ActionDefinition>;
