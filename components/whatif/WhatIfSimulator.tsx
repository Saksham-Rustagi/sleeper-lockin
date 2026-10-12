"use client";

import { useState, useMemo } from "react";
import { useStore } from "@/lib/store";
import { solveExactDP } from "@/lib/optimizerDP";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function WhatIfSimulator() {
  const weekData = useStore((state) => state.weekData);
  const updateProjection = useStore((state) => state.updateProjection);
  const updateActual = useStore((state) => state.updateActual);
  const varianceLambda = useStore((state) => state.varianceLambda);
  const setVarianceLambda = useStore((state) => state.setVarianceLambda);

  const [editingGame, setEditingGame] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState("");

  const dpSolution = useMemo(() => {
    if (!weekData) return null;
    try {
      return solveExactDP(weekData);
    } catch (error) {
      return null;
    }
  }, [weekData]);

  if (!weekData) return null;

  const handleEditProjection = (gameId: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      updateProjection(gameId, num);
      toast.success("Projection updated");
    }
    setEditingGame(null);
    setTempValue("");
  };

  const handleEditActual = (gameId: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      updateActual(gameId, num);
      toast.success("Actual updated");
    }
    setEditingGame(null);
    setTempValue("");
  };

  return (
    <div className="space-y-6">
      {/* DP Solution Comparison */}
      {dpSolution && (
        <Card>
          <CardHeader>
            <CardTitle>Best possible with hindsight</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <span className="font-semibold">Hindsight optimum:</span>
                <span className="text-3xl font-bold text-green-600">
                  {dpSolution.total.toFixed(1)}
                </span>
              </div>

              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Optimal Assignment:</h4>
                {Array.from(dpSolution.plan.assignments.entries()).map(([slot, assignment]) => {
                  const player = weekData.players.find((p) => p.id === assignment.playerId);
                  return (
                    <div key={slot} className="flex justify-between items-center text-sm border-b pb-2">
                      <div>
                        <Badge variant="outline" className="mr-2">{slot}</Badge>
                        <span className="font-medium">{player?.name}</span>
                      </div>
                      <span className="font-semibold">{assignment.points.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Risk Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Risk Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Variance Lambda (λ): {varianceLambda.toFixed(2)}
            </label>
            <Slider
              value={[varianceLambda]}
              onValueChange={(v) => setVarianceLambda(v[0])}
              min={-1}
              max={1}
              step={0.1}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-2">
              EV = projection + λ × variance. Negative values favor low variance, positive favor high variance.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Edit Projections */}
      <Card>
        <CardHeader>
          <CardTitle>Edit Projections & Actuals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {weekData.games.map((game) => {
              const player = weekData.players.find((p) => p.id === game.playerId);
              const isEditing = editingGame === game.gameId;

              return (
                <div
                  key={game.gameId}
                  className="flex justify-between items-center p-2 border-b"
                >
                  <div className="flex-1">
                    <div className="font-medium text-sm">{player?.name}</div>
                    <div className="text-xs text-gray-500">vs {game.opponent}</div>
                  </div>

                  <div className="flex gap-2 items-center">
                    {isEditing ? (
                      <>
                        <Input
                          type="number"
                          value={tempValue}
                          onChange={(e) => setTempValue(e.target.value)}
                          className="w-20 h-8"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            if (game.status === "FINAL") {
                              handleEditActual(game.gameId, tempValue);
                            } else {
                              handleEditProjection(game.gameId, tempValue);
                            }
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingGame(null);
                            setTempValue("");
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {game.actual !== undefined ? (
                          <div className="text-sm">
                            <span className="font-semibold text-green-600">
                              {game.actual.toFixed(1)}
                            </span>
                            <span className="text-gray-400 ml-1">actual</span>
                          </div>
                        ) : (
                          <div className="text-sm">
                            <span className="font-semibold">
                              {game.projection.toFixed(1)}
                            </span>
                            <span className="text-gray-400 ml-1">proj</span>
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingGame(game.gameId);
                            setTempValue(
                              game.actual !== undefined
                                ? game.actual.toString()
                                : game.projection.toString()
                            );
                          }}
                        >
                          Edit
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

