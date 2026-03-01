import { useState, useMemo } from 'react';
import { useQuery } from 'convex/react';
import ReactModal from 'react-modal';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';

// Need definitions for display (colors, thresholds)
import { needRegistry } from '../psyche/data/needs';
import { NeedId } from '../psyche/registries';
import { OPINION_TOPICS, OPINION_NEUTRAL } from '../psyche/data/opinions';
import { getEmotionLabel } from '../psyche/emotions';
import { NEUTRAL_THRESHOLD } from '../psyche/data/emotions';

if (typeof window !== 'undefined') {
  ReactModal.setAppElement('#root');
}

interface DecisionLogEntry {
  _id: string;
  timestamp: number;
  chosenActionEmoji: string;
  chosenActionName: string;
  chosenScore: number;
  location: string;
  conflicts?: Array<{ actionId: string; penalty: number; values: string[] }>;
  alternatives: Array<{ actionEmoji: string; actionName: string; score: number }>;
  needsSnapshot: Array<{
    needId: string;
    currentValue: number;
    maxValue: number;
    isCritical: boolean;
    urgencyScore?: number;
  }>;
}

type MemoryFilter = 'all' | 'conversation' | 'reflection' | 'relationship';

export default function PsychePanel({
  worldId,
  game,
  playerId,
}: {
  worldId: Id<'worlds'>;
  game: ServerGame;
  playerId: GameId<'players'>;
}) {
  // Find the agent for this player
  const agent = [...game.world.agents.values()].find((a) => a.playerId === playerId);
  const agentId = agent?.id;

  const needs = useQuery(
    api.psyche.functions.getAgentNeeds,
    agentId ? { worldId, agentId: agentId as string } : 'skip',
  );

  const decisionLog = useQuery(
    api.psyche.functions.getDecisionLog,
    agentId ? { worldId, agentId: agentId as string } : 'skip',
  );

  // Relationships query uses player ID (relationships are keyed by player ID)
  const relationships = useQuery(api.psyche.functions.getAgentRelationships, {
    worldId,
    agentId: playerId as string,
  });

  // Opinions query also keyed by player ID
  const opinions = useQuery(api.psyche.functions.getAgentOpinions, {
    worldId,
    agentId: playerId as string,
  });

  // Emotion query (keyed by player ID)
  const emotion = useQuery(api.psyche.functions.getAgentEmotion, {
    worldId,
    agentId: playerId as string,
  });

  // Memories modal state
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [memoryFilter, setMemoryFilter] = useState<MemoryFilter>('all');
  const [showAllRelationships, setShowAllRelationships] = useState(false);

  // Only fetch memories when modal is open (no cost when closed)
  const memories = useQuery(
    api.agent.memory.getAgentMemories,
    memoriesOpen ? { worldId, playerId: playerId as string } : 'skip',
  );

  const playerName = game.playerDescriptions.get(playerId)?.name ?? 'Agent';

  const sortedNeeds = useMemo(
    () => (needs ? [...needs].sort((a, b) => a.currentValue - b.currentValue) : []),
    [needs],
  );

  const sortedOpinions = useMemo(
    () =>
      opinions
        ? [...opinions].sort(
            (a, b) => Math.abs(b.value - OPINION_NEUTRAL) - Math.abs(a.value - OPINION_NEUTRAL),
          )
        : [],
    [opinions],
  );

  const filteredMemories = useMemo(
    () => memories?.filter((m) => memoryFilter === 'all' || m.data.type === memoryFilter),
    [memories, memoryFilter],
  );

  if (!agent || !agentId) {
    return null;
  }

  const displayedRelationships = showAllRelationships
    ? relationships
    : relationships?.slice(0, 5);

  return (
    <div className="mt-4">
      {/* ─── Needs Section ─── */}
      <SectionHeader title="Needs" />
      <div className="mt-2 space-y-2">
        {needs === undefined ? (
          <div className="text-sm text-brown-400 text-center py-2">Loading...</div>
        ) : needs.length > 0 ? (
          sortedNeeds.map((need) => {
            const def = needRegistry.get(need.needId as NeedId);
            if (!def) return null;
            return (
              <NeedBar
                key={need.needId}
                name={def.name}
                value={need.currentValue}
                maxValue={def.maxValue}
                criticalThreshold={def.criticalThreshold}
                weight={def.priorityWeight}
              />
            );
          })
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">Not initialized yet...</div>
        )}
      </div>

      {/* ─── Opinions Section ─── */}
      <SectionHeader title="Opinions" className="mt-4" />
      <div className="mt-2 space-y-2">
        {opinions === undefined ? (
          <div className="text-sm text-brown-400 text-center py-2">Loading...</div>
        ) : opinions.length > 0 ? (
          sortedOpinions.map((op) => {
            const topic = OPINION_TOPICS.find((t) => t.id === op.topicId);
            if (!topic) return null;
            return <OpinionBar key={op.topicId} name={topic.name} value={op.value} />;
          })
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">Not initialized yet...</div>
        )}
      </div>

      {/* ─── Emotion Section ─── */}
      <SectionHeader title="Emotion" className="mt-4" />
      <div className="mt-2">
        {emotion === undefined ? (
          <div className="text-sm text-brown-400 text-center py-2">Loading...</div>
        ) : emotion ? (
          <EmotionIndicator valence={emotion.valence} arousal={emotion.arousal} />
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">No emotional state yet...</div>
        )}
      </div>

      {/* ─── Relationships Section ─── */}
      <SectionHeader title="Relationships" className="mt-4" />
      <div className="mt-2 space-y-3">
        {relationships === undefined ? (
          <div className="text-sm text-brown-400 text-center py-2">Loading...</div>
        ) : relationships.length > 0 ? (
          <>
            {displayedRelationships?.map((rel) => {
              const targetName =
                game.playerDescriptions.get(rel.toAgentId as GameId<'players'>)?.name ??
                rel.toAgentId;
              const timeSince = getTimeAgo(rel.lastInteraction);
              return (
                <RelationshipCard
                  key={rel.toAgentId}
                  targetName={targetName}
                  trust={rel.trust}
                  affinity={rel.affinity}
                  respect={rel.respect}
                  frequency={rel.frequency}
                  familiarity={rel.familiarity}
                  lastInteraction={timeSince}
                />
              );
            })}
            {relationships.length > 5 && !showAllRelationships && (
              <button
                onClick={() => setShowAllRelationships(true)}
                className="w-full text-xs text-brown-400 hover:text-brown-200 py-1 cursor-pointer"
              >
                Show all {relationships.length} relationships
              </button>
            )}
          </>
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">Not initialized yet...</div>
        )}
      </div>

      {/* ─── Decision Log Section ─── */}
      <SectionHeader title="Decisions" className="mt-4" />
      <div className="mt-2 space-y-3">
        {decisionLog === undefined ? (
          <div className="text-sm text-brown-400 text-center py-2">Loading...</div>
        ) : decisionLog.length > 0 ? (
          decisionLog.map((entry, i) => (
            <DecisionEntry key={entry._id} entry={entry} isLatest={i === 0} />
          ))
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">Not initialized yet...</div>
        )}
      </div>

      {/* ─── Memories Button ─── */}
      <div className="mt-4">
        <button
          onClick={() => setMemoriesOpen(true)}
          className="w-full bg-brown-700 hover:bg-brown-600 transition-colors p-2 font-display text-lg tracking-wider text-center rounded cursor-pointer"
        >
          Memories
        </button>
      </div>

      {/* ─── Memories Modal ─── */}
      <ReactModal
        isOpen={memoriesOpen}
        onRequestClose={() => setMemoriesOpen(false)}
        style={memoryModalStyles}
        contentLabel="Agent memories"
      >
        <div className="font-body">
          <h2 className="font-display text-xl tracking-wider text-center mb-4">
            {playerName}'s Memories
          </h2>

          {/* Filter tabs */}
          <div className="flex gap-1.5 mb-4 justify-center flex-wrap">
            {(['all', 'reflection', 'conversation', 'relationship'] as MemoryFilter[]).map(
              (tab) => (
                <button
                  key={tab}
                  onClick={() => setMemoryFilter(tab)}
                  className={`px-3 py-1 text-sm rounded cursor-pointer transition-colors ${
                    memoryFilter === tab
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {tab !== 'all' && memories
                    ? ` (${memories.filter((m) => m.data.type === tab).length})`
                    : ''}
                </button>
              ),
            )}
          </div>

          {/* Memory list */}
          <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
            {!filteredMemories || filteredMemories.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-6">
                {memories && memories.length === 0
                  ? "No memories yet — this agent hasn't completed any conversations."
                  : 'No memories of this type.'}
              </div>
            ) : (
              filteredMemories.map((memory) => (
                <MemoryCard key={memory._id} memory={memory} />
              ))
            )}
          </div>

          {/* Close button */}
          <div className="mt-4 text-center">
            <button
              onClick={() => setMemoriesOpen(false)}
              className="px-6 py-1.5 bg-gray-700 hover:bg-gray-600 text-sm rounded cursor-pointer transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </ReactModal>
    </div>
  );
}

// ─── Need Bar Component ─────────────────────────────────────

function NeedBar({
  name,
  value,
  maxValue,
  criticalThreshold,
  weight,
}: {
  name: string;
  value: number;
  maxValue: number;
  criticalThreshold: number;
  weight: number;
}) {
  const percent = Math.round((value / maxValue) * 100);
  const isCritical = value < criticalThreshold;
  const isLow = value < maxValue * 0.4;

  // Color: red if critical, yellow if low, green if ok
  const barColor = isCritical ? 'bg-red-500' : isLow ? 'bg-yellow-500' : 'bg-green-500';

  const glowClass = isCritical ? 'shadow-[0_0_8px_rgba(239,68,68,0.6)]' : '';

  return (
    <div className="px-1">
      <div className="flex justify-between text-xs mb-0.5">
        <span className={`font-bold ${isCritical ? 'text-red-400' : 'text-brown-200'}`}>
          {name}
          {isCritical && ' ⚠'}
        </span>
        <span className="text-brown-400">
          {Math.round(value)}/{maxValue}
          <span className="text-brown-600 ml-1">({weight.toFixed(1)}x)</span>
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={maxValue}
        aria-label={`${name}: ${Math.round(value)} of ${maxValue}`}
        className={`w-full bg-brown-900 h-2.5 rounded-sm ${glowClass}`}
      >
        {/* Critical threshold marker */}
        <div className="relative w-full h-full">
          <div
            className={`h-full rounded-sm transition-all duration-500 ${barColor}`}
            style={{ width: `${percent}%` }}
          />
          <div
            className="absolute top-0 h-full border-l border-brown-400 opacity-40"
            style={{ left: `${(criticalThreshold / maxValue) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Opinion Bar Component (center-anchored, 0..10) ─────────

function getOpinionLabel(value: number): string {
  if (value >= 9) return 'loves';
  if (value >= 7) return 'likes';
  if (value <= 2) return 'hates';
  if (value <= 4) return 'dislikes';
  return 'neutral';
}

function OpinionBar({ name, value }: { name: string; value: number }) {
  // Center at 5 (neutral). Green extends right for positive, orange extends left for negative.
  const normalized = (value / 10) * 100; // 0..100, 50 = neutral
  const isPositive = value >= OPINION_NEUTRAL;

  const barLeft = isPositive ? 50 : normalized;
  const barWidth = isPositive ? normalized - 50 : 50 - normalized;

  const barColor = isPositive ? 'bg-green-500' : 'bg-orange-500';
  const label = getOpinionLabel(value);

  return (
    <div className="px-1">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-brown-200">{name}</span>
        <span
          className={`tabular-nums ${isPositive && value > OPINION_NEUTRAL ? 'text-green-400' : value < OPINION_NEUTRAL ? 'text-orange-400' : 'text-brown-400'}`}
        >
          {label} ({Math.round(value)}/10)
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-label={`${name}: ${label} (${Math.round(value)}/10)`}
        className="w-full bg-brown-800 h-1.5 rounded-sm relative"
      >
        {/* Center line (neutral = 5) */}
        <div className="absolute top-0 h-full border-l border-brown-500" style={{ left: '50%' }} />
        {/* Value bar */}
        <div
          className={`absolute top-0 h-full rounded-sm transition-all duration-500 ${barColor}`}
          style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

// ─── Emotion Indicator Component (2D circumplex dot plot) ────

function EmotionIndicator({ valence, arousal }: { valence: number; arousal: number }) {
  const { label, intensity } = getEmotionLabel({ valence, arousal, lastUpdated: 0 });

  // Map valence/arousal (-1..1) to percentage position (0..100)
  const dotX = ((valence + 1) / 2) * 100;
  const dotY = ((1 - arousal) / 2) * 100; // invert Y: high arousal = top

  // Dot color based on valence
  const dotColor =
    intensity < NEUTRAL_THRESHOLD
      ? 'bg-gray-400'
      : valence > 0
        ? 'bg-green-400'
        : 'bg-red-400';

  // Intensity descriptor
  let intensityLabel = '';
  if (intensity < NEUTRAL_THRESHOLD) {
    intensityLabel = 'neutral';
  } else if (intensity > 0.7) {
    intensityLabel = `very ${label}`;
  } else if (intensity < 0.4) {
    intensityLabel = `slightly ${label}`;
  } else {
    intensityLabel = label;
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* 2D plot */}
      <div className="relative w-28 h-28 bg-brown-900 rounded border border-brown-700">
        {/* Crosshairs */}
        <div className="absolute top-0 left-1/2 h-full border-l border-brown-700" />
        <div className="absolute left-0 top-1/2 w-full border-t border-brown-700" />

        {/* Quadrant labels */}
        <span className="absolute top-0.5 left-1 text-brown-600 text-[8px]">stressed</span>
        <span className="absolute top-0.5 right-1 text-brown-600 text-[8px]">excited</span>
        <span className="absolute bottom-0.5 left-1 text-brown-600 text-[8px]">sad</span>
        <span className="absolute bottom-0.5 right-1 text-brown-600 text-[8px]">calm</span>

        {/* Dot */}
        <div
          className={`absolute w-3 h-3 rounded-full ${dotColor} shadow-[0_0_6px_rgba(255,255,255,0.3)] transition-all duration-700`}
          style={{
            left: `calc(${dotX}% - 6px)`,
            top: `calc(${dotY}% - 6px)`,
          }}
        />
      </div>

      {/* Label below */}
      <div className="text-xs text-brown-200 text-center">
        {intensityLabel}
        <span className="text-brown-500 ml-1.5">
          v:{valence >= 0 ? '+' : ''}{valence.toFixed(2)} a:{arousal >= 0 ? '+' : ''}{arousal.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

// ─── Decision Entry Component ───────────────────────────────

function DecisionEntry({
  entry,
  isLatest,
}: {
  entry: DecisionLogEntry;
  isLatest: boolean;
}) {
  const timeAgo = getTimeAgo(entry.timestamp);
  const criticalNeeds = entry.needsSnapshot.filter((n) => n.isCritical);

  // Highest urgency score across all needs, used to normalise the bars
  const maxUrgency = Math.max(...entry.needsSnapshot.map((n) => n.urgencyScore ?? 0), 0.01);

  return (
    <div
      className={`bg-brown-900 rounded px-2.5 py-2 text-sm ${
        isLatest ? 'border border-brown-600' : 'opacity-75'
      }`}
    >
      {/* Header: chosen action + time */}
      <div className="flex justify-between items-center">
        <span className="font-bold text-brown-100">
          {entry.chosenActionEmoji} {entry.chosenActionName}
        </span>
        <span className="text-brown-500 text-xs">{timeAgo}</span>
      </div>

      {/* Score + location */}
      <div className="flex justify-between text-xs mt-0.5 text-brown-400">
        <span>score: {entry.chosenScore.toFixed(1)}</span>
        <span>@ {entry.location}</span>
      </div>

      {/* Moral conflict badges */}
      {entry.conflicts && entry.conflicts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {entry.conflicts.map((conflict) => (
            <span
              key={conflict.actionId}
              className="inline-flex items-center gap-1 rounded bg-yellow-900/40 px-1.5 py-0.5 text-xs text-yellow-300"
              title={`Moral conflict: ${conflict.values.join(', ')} (penalty: ${conflict.penalty.toFixed(2)})`}
            >
              ⚠️ {conflict.values.join(', ')}
            </span>
          ))}
        </div>
      )}

      {/* Critical needs flag */}
      {criticalNeeds.length > 0 && (
        <div className="text-xs mt-1 text-red-400">
          ⚠ Critical: {criticalNeeds.map((n) => n.needId).join(', ')}
        </div>
      )}

      {/* Alternatives (collapsed for non-latest) */}
      {isLatest && entry.alternatives.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-brown-800">
          <div className="text-xs text-brown-500 mb-0.5">Alternatives considered:</div>
          {entry.alternatives.slice(0, 3).map((alt, i) => (
            <div key={i} className="flex justify-between text-xs text-brown-500">
              <span>
                {alt.actionEmoji} {alt.actionName}
              </span>
              <span>{alt.score.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Need urgency scores at decision time */}
      {isLatest && (
        <div className="mt-1.5 pt-1.5 border-t border-brown-800">
          <div className="text-xs text-brown-500 mb-1">Need urgency at decision:</div>
          <div className="space-y-0.5">
            {[...entry.needsSnapshot]
              .sort((a, b) => (b.urgencyScore ?? 0) - (a.urgencyScore ?? 0))
              .map((n) => {
                const urgency = n.urgencyScore ?? 0;
                const barPct = Math.round((urgency / maxUrgency) * 100);
                const barColor = n.isCritical
                  ? 'bg-red-500'
                  : urgency / maxUrgency > 0.6
                    ? 'bg-amber-400'
                    : 'bg-brown-500';
                return (
                  <div key={n.needId} className="flex items-center gap-1.5">
                    <span
                      className={`text-xs w-14 shrink-0 ${n.isCritical ? 'text-red-400 font-bold' : 'text-brown-400'}`}
                    >
                      {n.needId}
                    </span>
                    <div className="flex-1 h-1.5 bg-brown-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs w-8 text-right tabular-nums ${n.isCritical ? 'text-red-400 font-bold' : 'text-brown-500'}`}
                    >
                      {urgency.toFixed(2)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Relationship Card Component ─────────────────────────────

function RelationshipCard({
  targetName,
  trust,
  affinity,
  respect,
  frequency,
  familiarity,
  lastInteraction,
}: {
  targetName: string;
  trust: number;
  affinity: number;
  respect: number;
  frequency: number;
  familiarity: number;
  lastInteraction: string;
}) {
  return (
    <div className="bg-brown-900 rounded px-2.5 py-2">
      <div className="flex justify-between items-center mb-1.5">
        <span className="font-bold text-brown-100 text-sm">{targetName}</span>
        <span className="text-brown-500 text-xs">{lastInteraction}</span>
      </div>
      <div className="space-y-1">
        <BipolarBar label="Trust" value={trust} />
        <BipolarBar label="Affinity" value={affinity} />
        <BipolarBar label="Respect" value={respect} />
        <UnipolarBar label="Frequency" value={frequency} />
        <UnipolarBar label="Familiarity" value={familiarity} />
      </div>
    </div>
  );
}

// ─── Bipolar Bar (center-anchored, -100..100) ────────────────

function BipolarBar({ label, value }: { label: string; value: number }) {
  // Normalize to 0..100 range for positioning (50 = center = 0 value)
  const normalized = (value + 100) / 2;
  const isPositive = value >= 0;

  // Bar extends from center (50%) toward left (negative) or right (positive)
  const barLeft = isPositive ? 50 : normalized;
  const barWidth = isPositive ? normalized - 50 : 50 - normalized;

  const barColor = isPositive ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="px-1">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-brown-300">{label}</span>
        <span className={`${isPositive ? 'text-green-400' : 'text-red-400'} tabular-nums`}>
          {value > 0 ? '+' : ''}
          {Math.round(value)}
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(value)}`}
        className="w-full bg-brown-800 h-1.5 rounded-sm relative"
      >
        {/* Center line */}
        <div className="absolute top-0 h-full border-l border-brown-500" style={{ left: '50%' }} />
        {/* Value bar */}
        <div
          className={`absolute top-0 h-full rounded-sm transition-all duration-500 ${barColor}`}
          style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}

// ─── Unipolar Bar (0..100) ───────────────────────────────────

function UnipolarBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value);
  const isLow = value < 20;
  const barColor = isLow ? 'bg-brown-600' : 'bg-blue-400';

  return (
    <div className="px-1">
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-brown-300">{label}</span>
        <span className="text-brown-400 tabular-nums">{Math.round(value)}</span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(value)}`}
        className="w-full bg-brown-800 h-1.5 rounded-sm"
      >
        <div
          className={`h-full rounded-sm transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ─── Memory Card Component ───────────────────────────────────

const memoryTypeBadge: Record<string, { label: string; color: string }> = {
  reflection: { label: 'Reflection', color: 'bg-blue-600' },
  conversation: { label: 'Conversation', color: 'bg-green-700' },
  relationship: { label: 'Relationship', color: 'bg-gray-600' },
};

function MemoryCard({
  memory,
}: {
  memory: {
    _id: string;
    description: string;
    importance: number;
    _creationTime: number;
    data: { type: string };
  };
}) {
  const badge = memoryTypeBadge[memory.data.type] ?? {
    label: memory.data.type,
    color: 'bg-gray-600',
  };
  const stars = '\u2B50'.repeat(Math.min(Math.round(memory.importance), 9));
  const timeAgo = getTimeAgo(memory._creationTime);

  return (
    <div className="bg-[rgb(25,28,45)] rounded px-3 py-2.5 text-sm">
      {/* Header: stars + time */}
      <div className="flex justify-between items-start gap-2">
        <span className="text-xs" title={`Importance: ${memory.importance}/9`}>
          {stars || '(0)'}
        </span>
        <span className="text-gray-500 text-xs shrink-0">{timeAgo}</span>
      </div>
      {/* Description */}
      <p className="text-gray-200 mt-1 leading-snug">{memory.description}</p>
      {/* Type badge */}
      <div className="mt-1.5">
        <span className={`text-xs px-1.5 py-0.5 rounded ${badge.color} text-white`}>
          {badge.label}
        </span>
      </div>
    </div>
  );
}

// ─── Section Header Component ─────────────────────────────────

function SectionHeader({ title, className }: { title: string; className?: string }) {
  return (
    <div className={`box ${className ?? ''}`}>
      <h2 className="bg-brown-700 p-2 font-display text-lg tracking-wider shadow-solid text-center">
        {title}
      </h2>
    </div>
  );
}

// ─── Modal Styles ────────────────────────────────────────────

const memoryModalStyles = {
  overlay: {
    backgroundColor: 'rgb(0, 0, 0, 75%)' as const,
    zIndex: 12,
  },
  content: {
    top: '50%',
    left: '50%',
    right: 'auto' as const,
    bottom: 'auto' as const,
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    border: '10px solid rgb(23, 20, 33)',
    borderRadius: '0',
    background: 'rgb(35, 38, 58)',
    color: 'white',
    fontFamily: '"Upheaval Pro", "sans-serif"',
  },
};

// ─── Utilities ───────────────────────────────────────────────

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
