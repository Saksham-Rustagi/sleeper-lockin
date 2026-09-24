"use client";

import { useStore, useLockedState } from "@/lib/store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OptimalLineupNow from "./OptimalLineupNow";

export default function LineupGrid() {
  const weekData = useStore((state) => state.weekData);
  const unlockSlot = useStore((state) => state.unlockSlot);
  const lockedSlots = useStore((state) => state.lockedSlots);

  if (!weekData) return null;

  return (
    <Tabs defaultValue="optimal" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="optimal">Optimal Next Lineup</TabsTrigger>
        <TabsTrigger value="locked">Locked Lineup</TabsTrigger>
      </TabsList>

      <TabsContent value="optimal" className="mt-6 space-y-4">
        <OptimalLineupNow />
      </TabsContent>

      <TabsContent value="locked" className="mt-6 space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="grid md:grid-cols-3 gap-4">
              {weekData.league.startingSlots.map((slot, idx) => {
                const locked = lockedSlots[slot];
                const player = locked
                  ? weekData.players.find((p) => p.id === locked.playerId)
                  : null;

                return (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 ${
                      locked
                        ? "bg-purple-50 dark:bg-purple-900/20 border-purple-300"
                        : "bg-gray-50 dark:bg-gray-800 border-gray-300"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant={locked ? "default" : "outline"}>
                        {slot.replace(/_(\d+)$/, ' ($1)')}
                      </Badge>
                      {locked && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => unlockSlot(slot)}
                        >
                          Unlock
                        </Button>
                      )}
                    </div>

                    {locked && player ? (
                      <div className="space-y-2">
                        <div className="font-semibold">{player.name}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {player.eligible.join(", ")}
                        </div>
                        <div className="text-2xl font-bold text-purple-600">
                          {locked.points.toFixed(1)}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-400">
                        Open
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="font-semibold mb-4">Bench Players</h3>
            <div className="grid md:grid-cols-2 gap-3">
              {weekData.roster.bench.map((playerId) => {
                const player = weekData.players.find((p) => p.id === playerId);
                if (!player) return null;

                return (
                  <div
                    key={playerId}
                    className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-800"
                  >
                    <div className="font-medium">{player.name}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {player.eligible.join(", ")}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

