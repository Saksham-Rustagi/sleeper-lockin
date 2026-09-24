"use client";

import { useMemo } from "react";
import { useStore, useLockedState } from "@/lib/store";
import { recommendStartsAt } from "@/lib/optimizer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function OptimalLineupNow() {
  const weekData = useStore((state) => state.weekData);
  const varianceLambda = useStore((state) => state.varianceLambda);
  const lockedState = useLockedState();

  const nextGames = useMemo(() => {
    if (!weekData) return [];
    
    const now = new Date();
    const upcoming = weekData.games
      .filter(g => g.status === "UPCOMING" && new Date(g.tipoffUtc) > now)
      .sort((a, b) => new Date(a.tipoffUtc).getTime() - new Date(b.tipoffUtc).getTime());
    
    return upcoming;
  }, [weekData]);

  const nextTipoff = nextGames[0]?.tipoffUtc;

  // Get complete optimal lineup for all open slots
  const optimalStarts = useMemo(() => {
    if (!weekData) return new Map();
    
    // Get all open slots (not yet locked)
    const openSlots = weekData.league.startingSlots.filter(
      slot => !lockedState.lockedSlots.has(slot)
    );
    
    if (openSlots.length === 0) return new Map();
    
    // Get all available players (not locked)
    const availablePlayers = weekData.players.filter(
      p => !lockedState.lockedPlayers.has(p.id)
    );
    
    // Build weight map based on best upcoming game for each player
    const weights = new Map<string, number>();
    for (const player of availablePlayers) {
      const playerGames = nextGames.filter(g => g.playerId === player.id);
      if (playerGames.length > 0) {
        // Use projection from next game
        const nextGame = playerGames[0];
        weights.set(player.id, nextGame.projection);
      }
    }
    
    // Only include players who have upcoming games
    const playersWithGames = availablePlayers.filter(p => weights.has(p.id));
    
    if (playersWithGames.length === 0) return new Map();
    
    // Use matching algorithm to assign players to all open slots
    const { solveMaxWeightMatching } = require("@/lib/matching");
    return solveMaxWeightMatching(
      playersWithGames,
      openSlots,
      weights,
      weekData.league.slotEligibility
    );
  }, [weekData, nextGames, lockedState, varianceLambda]);

  if (!weekData) return null;

  const handleCopyLineup = () => {
    let lineup = "Optimal Lineup:\n";
    optimalStarts.forEach((playerId: string, slot: any) => {
      const player = weekData.players.find(p => p.id === playerId);
      if (player) {
        const formattedSlot = String(slot).replace(/_(\d+)$/, ' ($1)');
        lineup += `${formattedSlot}: ${player.name}\n`;
      }
    });
    
    navigator.clipboard.writeText(lineup);
    toast.success("Lineup copied to clipboard!");
  };

  if (optimalStarts.size === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Optimal Lineup</CardTitle>
          <CardDescription>
            {nextGames.length === 0 
              ? "No upcoming games scheduled"
              : "All slots are locked"
            }
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const nextTipoffDate = nextTipoff ? new Date(nextTipoff) : null;
  const playersInNextGame = nextTipoff 
    ? nextGames.filter(g => g.tipoffUtc === nextTipoff).map(g => g.playerId)
    : [];

  // Get all slots to display (both optimal assignments and locked)
  const allSlots = weekData.league.startingSlots;

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Optimal Lineup - All Starting Slots</CardTitle>
            <CardDescription>
              {nextTipoffDate 
                ? `Next games: ${nextTipoffDate.toLocaleString()}`
                : "Showing optimal assignments for upcoming games"
              }
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={handleCopyLineup}>
            Copy Lineup
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3">
          {allSlots.map((slot, index) => {
            const playerId = optimalStarts.get(slot);
            const locked = lockedState.lockedSlots.get(slot);
            const player = playerId 
              ? weekData.players.find(p => p.id === playerId)
              : locked 
                ? weekData.players.find(p => p.id === locked.playerId)
                : null;
            const game = playerId ? nextGames.find(g => g.playerId === playerId) : null;

            return (
              <div
                key={`${slot}-${index}`}
                className={`p-3 border rounded-lg ${
                  locked
                    ? "bg-purple-50 dark:bg-purple-900/20 border-purple-300"
                    : playerId && playersInNextGame.includes(playerId)
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-300"
                    : playerId
                    ? "bg-green-50 dark:bg-green-900/20 border-green-300"
                    : "bg-gray-50 dark:bg-gray-800"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <Badge variant={locked ? "default" : "outline"}>
                    {slot.replace(/_(\d+)$/, ' ($1)')}
                  </Badge>
                  {locked && (
                    <Badge variant="default" className="text-xs">
                      Locked
                    </Badge>
                  )}
                  {!locked && playerId && playersInNextGame.includes(playerId) && (
                    <Badge variant="secondary" className="text-xs">
                      Next
                    </Badge>
                  )}
                </div>
                {player ? (
                  <>
                    <div className="font-semibold text-sm">{player.name}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {player.eligible.join(", ")}
                    </div>
                    {locked ? (
                      <div className="text-lg mt-2 font-bold text-purple-600">
                        {locked.points.toFixed(1)} pts
                      </div>
                    ) : game ? (
                      <div className="text-sm mt-2 font-semibold">
                        {game.projection.toFixed(1)} proj
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="text-center py-2 text-gray-400 text-sm">
                    Open
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Show bench players in next game */}
        {playersInNextGame.filter(pid => 
          !Array.from(optimalStarts.values()).includes(pid) && 
          !lockedState.lockedPlayers.has(pid)
        ).length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-sm font-semibold mb-2 text-gray-600 dark:text-gray-400">
              Bench (Not Starting):
            </div>
            <div className="flex flex-wrap gap-2">
              {playersInNextGame
                .filter(pid => 
                  !Array.from(optimalStarts.values()).includes(pid) &&
                  !lockedState.lockedPlayers.has(pid)
                )
                .map(playerId => {
                  const player = weekData.players.find(p => p.id === playerId);
                  const game = nextGames.find(g => g.playerId === playerId);
                  return (
                    <Badge key={playerId} variant="secondary">
                      {player?.name} ({game?.projection.toFixed(1)})
                    </Badge>
                  );
                })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

