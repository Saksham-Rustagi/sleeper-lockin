"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore, useLockedTotal } from "@/lib/store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import WeekTimeline from "@/components/timeline/WeekTimeline";
import LiveDecisionsPanel from "@/components/decisions/LiveDecisionsPanel";
import WhatIfSimulator from "@/components/whatif/WhatIfSimulator";
import LineupGrid from "@/components/lineup/LineupGrid";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import HelpDialog from "@/components/help/HelpDialog";
import ExportImport from "@/components/export/ExportImport";

export default function OptimizerPage() {
  const router = useRouter();
  const weekData = useStore((state) => state.weekData);
  const riskMode = useStore((state) => state.riskMode);
  const setRiskMode = useStore((state) => state.setRiskMode);
  const reset = useStore((state) => state.reset);
  const lockedTotal = useLockedTotal();
  const lockedSlots = useStore((state) => state.lockedSlots);

  useEffect(() => {
    if (!weekData) {
      router.push("/setup");
    }
  }, [weekData, router]);

  if (!weekData) {
    return null;
  }

  const openSlots = weekData.league.startingSlots.length - Object.keys(lockedSlots).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b bg-white dark:bg-gray-800">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold">Lock-In Optimizer</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {weekData.players.length} players • {weekData.games.length} games
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-sm text-gray-600 dark:text-gray-400">Locked Total</div>
                <div className="text-2xl font-bold">{lockedTotal.toFixed(1)}</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-600 dark:text-gray-400">Open Slots</div>
                <div className="text-2xl font-bold">{openSlots}</div>
              </div>
              <HelpDialog />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm("Reset all data?")) {
                    reset();
                    router.push("/");
                  }
                }}
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-4 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Risk Mode</label>
                  <Select value={riskMode} onValueChange={(v: any) => setRiskMode(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                      <SelectItem value="aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    {riskMode === "conservative" && "Lock earlier for safety (ε = -2)"}
                    {riskMode === "neutral" && "Balanced approach (ε = 0)"}
                    {riskMode === "aggressive" && "Wait for upside (ε = +2)"}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Lineup Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {weekData.league.startingSlots.map((slot, idx) => {
                    const locked = lockedSlots[slot];
                    return (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <span className="font-medium">{slot.replace(/_(\d+)$/, ' ($1)')}</span>
                        {locked ? (
                          <Badge variant="default">
                            {locked.points.toFixed(1)}
                          </Badge>
                        ) : (
                          <Badge variant="outline">Open</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <ExportImport />
          </div>

          {/* Main Tabs */}
          <div className="lg:col-span-3">
            <Tabs defaultValue="timeline" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="decisions">Live Decisions</TabsTrigger>
                <TabsTrigger value="lineup">Lineup</TabsTrigger>
                <TabsTrigger value="whatif">What-If</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline" className="mt-6">
                <WeekTimeline />
              </TabsContent>

              <TabsContent value="decisions" className="mt-6">
                <LiveDecisionsPanel />
              </TabsContent>

              <TabsContent value="lineup" className="mt-6">
                <LineupGrid />
              </TabsContent>

              <TabsContent value="whatif" className="mt-6">
                <WhatIfSimulator />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}

