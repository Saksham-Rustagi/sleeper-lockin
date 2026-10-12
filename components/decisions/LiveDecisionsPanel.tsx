"use client";

import { useMemo } from "react";
import { useStore, useLockedState } from "@/lib/store";
import { recommendLock } from "@/lib/optimizer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function LiveDecisionsPanel() {
  const weekData = useStore((state) => state.weekData);
  const riskMode = useStore((state) => state.riskMode);
  const varianceLambda = useStore((state) => state.varianceLambda);
  const lockGame = useStore((state) => state.lockGame);
  const lockedState = useLockedState();

  const finishedGames = useMemo(() => {
    if (!weekData) return [];
    // Sleeper only lets you lock a player's most recent finished game (before his next tip-off).
    const latest = new Map<string, (typeof weekData.games)[number]>();
    for (const g of weekData.games) {
      if (g.status !== "FINAL" || g.actual === undefined || lockedState.lockedPlayers.has(g.playerId)) continue;
      const cur = latest.get(g.playerId);
      if (!cur || new Date(g.tipoffUtc) > new Date(cur.tipoffUtc)) latest.set(g.playerId, g);
    }
    const now = Date.now();
    return Array.from(latest.values()).filter((g) => !weekData.games.some((n) => n.playerId === g.playerId && new Date(n.tipoffUtc) > new Date(g.tipoffUtc) && new Date(n.tipoffUtc).getTime() <= now));
  }, [weekData, lockedState.lockedPlayers]);

  if (!weekData) return null;

  const handleLockDecision = (gameId: string, playerId: string, actual: number) => {
    const decision = recommendLock(
      { playerId, gameId, actual },
      weekData,
      lockedState,
      riskMode,
      varianceLambda
    );

    if (decision.decision === "LOCK" && decision.slot) {
      lockGame(decision.slot, playerId, gameId, actual);
      toast.success(`Locked ${weekData.players.find(p => p.id === playerId)?.name} to ${decision.slot}!`);
    } else {
      toast.info(decision.rationale);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Games Ready for Lock Decision</CardTitle>
          <p className="text-xs text-gray-500">Only lockable if the player was in your starting lineup at tip-off and hasn&apos;t touched the bench since.</p>
        </CardHeader>
        <CardContent>
          {finishedGames.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No finished games available for locking
            </div>
          ) : (
            <div className="space-y-4">
              {finishedGames.map((game) => {
                const player = weekData.players.find((p) => p.id === game.playerId);
                const decision = recommendLock(
                  { playerId: game.playerId, gameId: game.gameId, actual: game.actual! },
                  weekData,
                  lockedState,
                  riskMode,
                  varianceLambda
                );

                return (
                  <div
                    key={game.gameId}
                    className="border rounded-lg p-4 space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-semibold text-lg">{player?.name}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {player?.eligible.join(", ")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-green-600">
                          {game.actual!.toFixed(1)}
                        </div>
                        <div className="text-xs text-gray-500">
                          (proj: {game.projection.toFixed(1)})
                        </div>
                      </div>
                    </div>

                    <div className={`p-3 rounded ${
                      decision.decision === "LOCK"
                        ? "bg-green-50 dark:bg-green-900/20"
                        : "bg-yellow-50 dark:bg-yellow-900/20"
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={decision.decision === "LOCK" ? "default" : "secondary"}>
                          {decision.decision}
                        </Badge>
                        {decision.slot && (
                          <Badge variant="outline">→ {decision.slot}</Badge>
                        )}
                        <span className="text-sm font-semibold">
                          Δ {decision.delta >= 0 ? "+" : ""}{decision.delta.toFixed(1)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-300">
                        {decision.rationale}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {decision.decision === "LOCK" && decision.slot ? (
                        <Button
                          className="flex-1"
                          onClick={() =>
                            handleLockDecision(game.gameId, game.playerId, game.actual!)
                          }
                        >
                          Lock to {decision.slot}
                        </Button>
                      ) : (
                        <Button
                          className="flex-1"
                          variant="outline"
                          onClick={() => toast.info(decision.rationale)}
                        >
                          Keep Open
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

