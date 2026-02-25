import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';

// Need definitions for display (colors, thresholds)
import { needRegistry } from '../psyche/data/needs';

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
  const relationships = useQuery(
    api.psyche.functions.getAgentRelationships,
    { worldId, agentId: playerId as string },
  );

  if (!agent || !agentId) {
    return null;
  }

  return (
    <div className="mt-4">
      {/* ─── Needs Section ─── */}
      <div className="box">
        <h2 className="bg-brown-700 p-2 font-display text-lg tracking-wider shadow-solid text-center">
          Needs
        </h2>
      </div>
      <div className="mt-2 space-y-2">
        {needs && needs.length > 0 ? (
          needs
            .sort((a, b) => a.currentValue - b.currentValue) // most urgent first
            .map((need) => {
              const def = needRegistry.get(need.needId);
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
          <div className="text-sm text-brown-300 text-center py-2">
            Needs not initialized yet...
          </div>
        )}
      </div>

      {/* ─── Relationships Section ─── */}
      <div className="box mt-4">
        <h2 className="bg-brown-700 p-2 font-display text-lg tracking-wider shadow-solid text-center">
          Relationships
        </h2>
      </div>
      <div className="mt-2 space-y-3">
        {relationships && relationships.length > 0 ? (
          relationships.map((rel) => {
            const targetName = game.playerDescriptions.get(rel.toAgentId as GameId<'players'>)?.name ?? rel.toAgentId;
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
          })
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">
            No relationships yet...
          </div>
        )}
      </div>

      {/* ─── Decision Log Section ─── */}
      <div className="box mt-4">
        <h2 className="bg-brown-700 p-2 font-display text-lg tracking-wider shadow-solid text-center">
          Decisions
        </h2>
      </div>
      <div className="mt-2 space-y-3">
        {decisionLog && decisionLog.length > 0 ? (
          decisionLog.map((entry, i) => (
            <DecisionEntry key={entry._id} entry={entry} isLatest={i === 0} />
          ))
        ) : (
          <div className="text-sm text-brown-300 text-center py-2">
            No decisions yet...
          </div>
        )}
      </div>
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
  const barColor = isCritical
    ? 'bg-red-500'
    : isLow
      ? 'bg-yellow-500'
      : 'bg-green-500';

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
      <div className={`w-full bg-brown-900 h-2.5 rounded-sm ${glowClass}`}>
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

// ─── Decision Entry Component ───────────────────────────────

function DecisionEntry({
  entry,
  isLatest,
}: {
  entry: {
    timestamp: number;
    chosenActionEmoji: string;
    chosenActionName: string;
    chosenScore: number;
    location: string;
    alternatives: {
      actionEmoji: string;
      actionName: string;
      score: number;
    }[];
    needsSnapshot: {
      needId: string;
      currentValue: number;
      maxValue: number;
      isCritical: boolean;
    }[];
  };
  isLatest: boolean;
}) {
  const timeAgo = getTimeAgo(entry.timestamp);
  const criticalNeeds = entry.needsSnapshot.filter((n) => n.isCritical);

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

      {/* Need values at decision time (for latest) */}
      {isLatest && (
        <div className="mt-1.5 pt-1.5 border-t border-brown-800">
          <div className="text-xs text-brown-500 mb-0.5">Needs at decision:</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {entry.needsSnapshot.map((n) => (
              <span
                key={n.needId}
                className={`text-xs ${n.isCritical ? 'text-red-400 font-bold' : 'text-brown-400'}`}
              >
                {n.needId}: {Math.round(n.currentValue)}
              </span>
            ))}
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
          {value > 0 ? '+' : ''}{Math.round(value)}
        </span>
      </div>
      <div className="w-full bg-brown-800 h-1.5 rounded-sm relative">
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
      <div className="w-full bg-brown-800 h-1.5 rounded-sm">
        <div
          className={`h-full rounded-sm transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
