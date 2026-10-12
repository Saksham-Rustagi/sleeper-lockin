"use client";

import { useMemo } from "react";
import { useStore, useLockedState } from "@/lib/store";
import { buildTimeline, recommendStartsAt } from "@/lib/optimizer";
import { groupByDay, getDayLabel, formatLocal } from "@/lib/time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import OptimalLineupNow from "@/components/lineup/OptimalLineupNow";

export default function WeekTimeline() {
  const weekData = useStore((state) => state.weekData);
  const varianceLambda = useStore((state) => state.varianceLambda);
  const lockedState = useLockedState();

  const timeline = useMemo(() => {
    if (!weekData) return [];
    return buildTimeline(weekData);
  }, [weekData]);

  const groupedEvents = useMemo(() => {
    return groupByDay(timeline);
  }, [timeline]);

  if (!weekData) return null;

  const handleApplyStarts = (time: string) => {
    const recommendation = recommendStartsAt(time, weekData, lockedState, varianceLambda);
    
    if (recommendation.size === 0) {
      toast.info("No start recommendations for this time");
      return;
    }

    let message = "Recommended starts:\n";
    recommendation.forEach((playerId, slot) => {
      const player = weekData.players.find(p => p.id === playerId);
      if (player) {
        message += `${slot}: ${player.name}\n`;
      }
    });

    toast.success(message);
  };

  return (
    <div className="space-y-6">
      {/* Optimal Lineup for Next Games */}
      <OptimalLineupNow />

      {/* Day by Day Timeline */}
      {Array.from(groupedEvents.entries()).map(([day, events]) => {
        const dayEvents = events.filter(e => e.type === "GAME_LOCK");
        const uniqueTimes = Array.from(new Set(dayEvents.map(e => e.time)));

        return (
          <Card key={day}>
            <CardHeader>
              <CardTitle className="text-lg">{getDayLabel(day)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {uniqueTimes.map((time) => {
                const gamesAtTime = weekData.games.filter(g => g.tipoffUtc === time);
                const lockedPlayerIds = lockedState.lockedPlayers;

                return (
                  <div key={time} className="border-l-4 border-blue-500 pl-4 py-2">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-semibold">{formatLocal(time)}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {gamesAtTime.length} game(s)
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleApplyStarts(time)}
                        disabled={lockedState.lockedSlots.size >= weekData.league.startingSlots.length}
                      >
                        View Recommendations
                      </Button>
                    </div>

                    <div className="grid gap-2 mt-3">
                      {gamesAtTime.map((game) => {
                        const player = weekData.players.find(p => p.id === game.playerId);
                        const isLocked = lockedPlayerIds.has(game.playerId);

                        return (
                          <div
                            key={game.gameId}
                            className="flex justify-between items-center p-2 bg-gray-50 dark:bg-gray-800 rounded"
                          >
                            <div className="flex-1">
                              <div className="font-medium">{player?.name || game.playerId}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {player?.eligible.join(", ")}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold">
                                {game.actual !== undefined ? (
                                  <span className="text-green-600">{game.actual.toFixed(1)} actual</span>
                                ) : (
                                  <span>{game.projection.toFixed(1)} proj</span>
                                )}
                              </div>
                              {isLocked && (
                                <Badge variant="secondary" className="mt-1">Locked</Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {groupedEvents.size === 0 && (
        <Card>
          <CardContent className="text-center py-12 text-gray-500">
            No games scheduled
          </CardContent>
        </Card>
      )}
    </div>
  );
}

