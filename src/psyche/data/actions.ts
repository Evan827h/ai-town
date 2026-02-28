import { ActionDefinition, ActionRegistry } from '../registries';

/**
 * v1 Actions Registry — ~12 actions with self-describing effects.
 *
 * Each action declares what it replenishes and costs via metadata.
 * The scorer reads this generically — it doesn't know what "hunger" means,
 * just that this action replenishes a need the agent is low on.
 *
 * locationRequirement maps to AI Town map locations.
 * 'any' or undefined = can be done anywhere.
 */

const actionDefinitions: ActionDefinition[] = [
  // === Cafe actions ===
  {
    id: 'eat_at_cafe',
    name: 'Eat at Cafe',
    description: 'Having a meal at the cafe',
    emoji: '🍽️',
    locationRequirement: 'cafe',
    duration: 30,
    replenishes: [{ needId: 'hunger', amount: 40 }],
    costs: [{ needId: 'energy', amount: 5 }],
    emotionalEffects: { valence: 0.15, arousal: -0.1 },
  },
  {
    id: 'socialize_at_cafe',
    name: 'Socialize at Cafe',
    description: 'Chatting with others at the cafe',
    emoji: '☕',
    locationRequirement: 'cafe',
    duration: 30,
    replenishes: [
      { needId: 'social', amount: 30 },
      { needId: 'fun', amount: 10 },
    ],
    costs: [{ needId: 'hunger', amount: 5 }],
    socialWeights: { affinity: 0.5, trust: 0.2, frequency: 0.3 },
    emotionalEffects: { valence: 0.2, arousal: 0.1 },
  },
  {
    id: 'people_watch',
    name: 'People Watch',
    description: 'Watching people go by at the cafe',
    emoji: '👀',
    locationRequirement: 'cafe',
    duration: 20,
    replenishes: [
      { needId: 'social', amount: 10 },
      { needId: 'fun', amount: 10 },
    ],
    costs: [],
    socialWeights: { affinity: 0.3, frequency: 0.3, familiarity: 0.4 },
    emotionalEffects: { valence: 0.05, arousal: -0.1 },
  },

  // === Home actions ===
  {
    id: 'sleep_at_home',
    name: 'Sleep',
    description: 'Sleeping at home',
    emoji: '😴',
    locationRequirement: 'home',
    duration: 45,
    replenishes: [
      { needId: 'energy', amount: 60 },
      { needId: 'comfort', amount: 20 },
    ],
    costs: [{ needId: 'social', amount: 5 }],
    emotionalEffects: { valence: 0.1, arousal: -0.2 },
  },
  {
    id: 'nap',
    name: 'Take a Nap',
    description: 'Taking a quick nap',
    emoji: '💤',
    locationRequirement: 'home',
    duration: 20,
    replenishes: [{ needId: 'energy', amount: 25 }],
    costs: [],
    emotionalEffects: { valence: 0.1, arousal: -0.2 },
  },
  {
    id: 'cook_at_home',
    name: 'Cook at Home',
    description: 'Preparing a home-cooked meal',
    emoji: '🍳',
    locationRequirement: 'home',
    duration: 40,
    replenishes: [
      { needId: 'hunger', amount: 35 },
      { needId: 'fun', amount: 10 },
    ],
    costs: [{ needId: 'energy', amount: 10 }],
    emotionalEffects: { valence: 0.2, arousal: 0.05 },
  },
  {
    id: 'play_game',
    name: 'Play a Game',
    description: 'Playing a game at home',
    emoji: '🎮',
    locationRequirement: 'home',
    duration: 30,
    replenishes: [{ needId: 'fun', amount: 30 }],
    costs: [{ needId: 'energy', amount: 5 }],
    emotionalEffects: { valence: 0.15, arousal: 0.1 },
  },

  // === Park actions ===
  {
    id: 'exercise_at_park',
    name: 'Exercise',
    description: 'Working out at the park',
    emoji: '🏃',
    locationRequirement: 'park',
    duration: 45,
    replenishes: [
      { needId: 'fun', amount: 20 },
      { needId: 'comfort', amount: 10 },
    ],
    costs: [
      { needId: 'energy', amount: 15 },
      { needId: 'hunger', amount: 10 },
    ],
    emotionalEffects: { valence: 0.15, arousal: 0.2 },
  },
  {
    id: 'rest_on_bench',
    name: 'Rest on Bench',
    description: 'Sitting on a park bench',
    emoji: '🪑',
    locationRequirement: 'park',
    duration: 20,
    replenishes: [
      { needId: 'energy', amount: 10 },
      { needId: 'comfort', amount: 15 },
    ],
    costs: [],
    emotionalEffects: { valence: 0.1, arousal: -0.2 },
  },
  {
    id: 'read_at_park',
    name: 'Read in the Park',
    description: 'Reading a book on a park bench',
    emoji: '📖',
    locationRequirement: 'park',
    duration: 30,
    replenishes: [
      { needId: 'fun', amount: 15 },
      { needId: 'comfort', amount: 10 },
    ],
    costs: [],
    emotionalEffects: { valence: 0.1, arousal: -0.15 },
  },

  // === Morally-weighted actions ===
  // These give the moral compass visible behavior — they replenish needs well
  // but carry ethical costs that vary by character profile.
  {
    id: 'gossip_at_cafe',
    name: 'Gossip',
    description: 'Sharing juicy rumors about others at the cafe',
    emoji: '🗣️',
    locationRequirement: 'cafe',
    duration: 20,
    replenishes: [
      { needId: 'social', amount: 25 },
      { needId: 'fun', amount: 15 },
    ],
    costs: [{ needId: 'energy', amount: 3 }],
    socialWeights: { affinity: 0.6, frequency: 0.4 },
    moralCosts: [{ moralValueId: 'honesty', severity: 0.6 }],
    emotionalEffects: { valence: 0.1, arousal: 0.15 },
  },
  {
    id: 'eavesdrop',
    name: 'Eavesdrop',
    description: 'Listening in on nearby conversations',
    emoji: '👂',
    locationRequirement: 'cafe',
    duration: 15,
    replenishes: [
      { needId: 'fun', amount: 10 },
      { needId: 'social', amount: 5 },
    ],
    costs: [],
    moralCosts: [
      { moralValueId: 'fairness', severity: 0.5 },
      { moralValueId: 'liberty', severity: 0.4 },
    ],
    emotionalEffects: { valence: -0.05, arousal: 0.15 },
  },
  {
    id: 'skip_plans',
    name: 'Skip Plans',
    description: 'Bailing on a planned meetup to stay home',
    emoji: '🙈',
    locationRequirement: 'home',
    duration: 10,
    replenishes: [{ needId: 'comfort', amount: 15 }],
    costs: [],
    moralCosts: [{ moralValueId: 'loyalty', severity: 0.7 }],
    emotionalEffects: { valence: -0.1, arousal: -0.1 },
  },

  // === Universal actions ===
  {
    id: 'chat_with_nearby',
    name: 'Chat',
    description: 'Chatting with someone nearby',
    emoji: '💬',
    duration: 20,
    replenishes: [{ needId: 'social', amount: 25 }],
    costs: [{ needId: 'energy', amount: 5 }],
    socialWeights: { affinity: 0.4, frequency: 0.4, trust: 0.2 },
    emotionalEffects: { valence: 0.15, arousal: 0.1 },
  },
  {
    id: 'wander',
    name: 'Wander',
    description: 'Wandering around aimlessly',
    emoji: '🚶',
    duration: 15,
    replenishes: [{ needId: 'fun', amount: 5 }],
    costs: [{ needId: 'energy', amount: 3 }],
    emotionalEffects: { valence: 0.0, arousal: -0.05 },
  },
];

export const actionRegistry: ActionRegistry = new Map(actionDefinitions.map((a) => [a.id, a]));

/**
 * Location-to-action mapping.
 * Returns which actions are available at a given location type.
 * '*' matches any location (universal actions).
 */
const locationActions: Record<string, string[]> = {
  cafe: ['eat_at_cafe', 'socialize_at_cafe', 'people_watch', 'gossip_at_cafe', 'eavesdrop'],
  home: ['sleep_at_home', 'nap', 'cook_at_home', 'play_game', 'skip_plans'],
  park: ['exercise_at_park', 'rest_on_bench', 'read_at_park'],
  '*': ['chat_with_nearby', 'wander'],
};

export function getActionsForLocation(location: string): ActionDefinition[] {
  const locationSpecific = locationActions[location] ?? [];
  const universal = locationActions['*'] ?? [];
  const actionIds = [...locationSpecific, ...universal];

  return actionIds
    .map((id) => actionRegistry.get(id))
    .filter((a): a is ActionDefinition => a !== undefined);
}
