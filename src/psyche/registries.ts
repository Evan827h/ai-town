/**
 * Core type definitions for the psyche registry system.
 *
 * The engine is generic — it iterates over whatever entries exist in registries.
 * New world systems (economy, jobs, class) add data to registries, not logic to the engine.
 *
 * Scoring Pipeline Order (executed in agentOperations.ts):
 *   1. scoreActions()              — base scores from need urgency × action effects
 *   2. applyRelationshipModifiers() — social actions boosted/penalized by relationship quality
 *   3. applyMoralFilter()          — hard vetoes + soft penalties + conflict detection
 *   (Phase 4 will add: wants/fears as tiebreakers)
 */

// ─── Registry ID Types (compile-time typo protection) ────
export type NeedId = 'hunger' | 'energy' | 'social' | 'comfort' | 'fun';
export type MoralValueId = 'honesty' | 'loyalty' | 'fairness' | 'care' | 'authority' | 'liberty' | 'tradition';
export type TopicId = 'food' | 'socializing' | 'nature' | 'work' | 'rest';
export type LocationId = 'home' | 'cafe' | 'park';

export interface NeedDefinition {
  id: NeedId;
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
  needId: NeedId;
  currentValue: number;
  lastUpdated: number; // game-time timestamp
}

export interface ActionEffect {
  needId: NeedId;
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
  locationRequirement?: LocationId;
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
  /** Emotional shift when this action completes: { valence, arousal } deltas */
  emotionalEffects?: { valence: number; arousal: number };
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
  id: MoralValueId;
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
  weights: Record<MoralValueId, number>;
  /** effectiveSeverity >= this → action is hard-vetoed (removed from options) */
  hardVetoThreshold: number;
  /** totalPenalty > this → flag internal conflict */
  conflictThreshold: number;
}

/** Moral cost attached to an action — how much it violates a value */
export interface MoralTag {
  /** ID of the moral value being violated (must exist in MORAL_VALUES registry) */
  moralValueId: MoralValueId;
  /** 0..1, base severity before weighting by character profile. Not clamped by the scorer — caller is responsible for valid range. */
  severity: number;
}

// ─── Opinion Tracking Types ──────────────────────────────────

export interface OpinionTopic {
  id: TopicId;
  name: string;
  description: string;
}

export interface AgentOpinion {
  topicId: TopicId;
  /** 0 = strongly opposed, 5 = neutral, 10 = strongly supportive */
  value: number;
  lastUpdated: number;
}

export interface OpinionDelta {
  topicId: TopicId;
  /** Positive = more favorable, negative = less favorable */
  delta: number;
}

// ─── Emotional Contagion Types ───────────────────────────────

export interface EmotionalState {
  /** -1 (miserable) to +1 (joyful) */
  valence: number;
  /** -1 (lethargic) to +1 (agitated) */
  arousal: number;
  lastUpdated: number;
}

export interface EmotionalProfile {
  baseline: { valence: number; arousal: number };
  /** 0..1 — how susceptible to others' emotions */
  receptivity: number;
  /** 0..1 — how strongly emotions radiate to others */
  charisma: number;
}

export interface EmotionAnchor {
  label: string;
  valence: number;
  arousal: number;
}

// ─── Location Zone Types ────────────────────────────────────

export interface LocationZone {
  id: LocationId;
  name: string;
  /** Bounding rectangle (tile coordinates) */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Point to pathfind to when heading to this location */
  destination: { x: number; y: number };
}

// Registry containers — simple Maps, not database rows
export type NeedRegistry = Map<NeedId, NeedDefinition>;
export type ActionRegistry = Map<string, ActionDefinition>;
export type LocationRegistry = Map<LocationId, LocationZone>;
