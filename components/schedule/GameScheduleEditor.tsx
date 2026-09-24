"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Player, GameProjection } from "@/types";
import { Trash2, Plus } from "lucide-react";

interface GameScheduleEditorProps {
  players: Player[];
  games: GameProjection[];
  onGamesUpdate: (games: GameProjection[]) => void;
}

export default function GameScheduleEditor({ players, games, onGamesUpdate }: GameScheduleEditorProps) {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [editingGame, setEditingGame] = useState<string | null>(null);

  const getPlayerGames = (playerId: string) => {
    return games.filter(g => g.playerId === playerId).sort((a, b) => 
      new Date(a.tipoffUtc).getTime() - new Date(b.tipoffUtc).getTime()
    );
  };

  const addGame = (playerId: string) => {
    const playerGames = getPlayerGames(playerId);
    const gameNumber = playerGames.length + 1;
    
    // Default to tomorrow at 7pm
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);

    const newGame: GameProjection = {
      gameId: `${playerId}_game_${Date.now()}`,
      playerId,
      tipoffUtc: tomorrow.toISOString(),
      opponent: "vs Opp",
      projection: 0,
      variance: 8,
      status: "UPCOMING"
    };

    onGamesUpdate([...games, newGame]);
    toast.success("Game added");
  };

  const updateGame = (gameId: string, updates: Partial<GameProjection>) => {
    const updatedGames = games.map(g => 
      g.gameId === gameId ? { ...g, ...updates } : g
    );
    onGamesUpdate(updatedGames);
  };

  const deleteGame = (gameId: string) => {
    onGamesUpdate(games.filter(g => g.gameId !== gameId));
    toast.success("Game deleted");
  };

  const handleDateTimeChange = (gameId: string, dateTimeLocal: string) => {
    // Convert local datetime to UTC
    const localDate = new Date(dateTimeLocal);
    updateGame(gameId, { tipoffUtc: localDate.toISOString() });
  };

  const formatDateTimeLocal = (isoString: string) => {
    const date = new Date(isoString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add Game Schedules & Projections</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Player List */}
            <div className="space-y-2">
              <h3 className="font-semibold mb-3">Select Player</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto border rounded-lg p-3">
                {players.map((player) => {
                  const playerGames = getPlayerGames(player.id);
                  const isSelected = selectedPlayer === player.id;

                  return (
                    <div
                      key={player.id}
                      onClick={() => setSelectedPlayer(player.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isSelected 
                          ? "bg-blue-100 dark:bg-blue-900/30 border-blue-300" 
                          : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium">{player.name}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            {player.eligible.join(", ")}
                          </div>
                        </div>
                        <Badge variant="secondary">
                          {playerGames.length} games
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Games Editor */}
            <div className="space-y-2">
              {selectedPlayer ? (
                <>
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="font-semibold">
                      {players.find(p => p.id === selectedPlayer)?.name}'s Games
                    </h3>
                    <Button
                      size="sm"
                      onClick={() => addGame(selectedPlayer)}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Game
                    </Button>
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {getPlayerGames(selectedPlayer).map((game, idx) => (
                      <Card key={game.gameId} className="p-4">
                        <div className="flex justify-between items-start mb-3">
                          <Badge variant="outline">Game {idx + 1}</Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteGame(game.gameId)}
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Date & Time</Label>
                            <Input
                              type="datetime-local"
                              value={formatDateTimeLocal(game.tipoffUtc)}
                              onChange={(e) => handleDateTimeChange(game.gameId, e.target.value)}
                              className="mt-1"
                            />
                          </div>

                          <div>
                            <Label className="text-xs">Projected Points</Label>
                            <Input
                              type="number"
                              step="0.1"
                              value={game.projection}
                              onChange={(e) => updateGame(game.gameId, { projection: parseFloat(e.target.value) || 0 })}
                              placeholder="Enter projection"
                              className="mt-1"
                            />
                          </div>
                        </div>
                      </Card>
                    ))}

                    {getPlayerGames(selectedPlayer).length === 0 && (
                      <div className="text-center py-8 text-gray-500">
                        No games added yet. Click "Add Game" to start.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-96 flex items-center justify-center text-gray-500">
                  Select a player to add/edit games
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Week Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{players.length}</div>
              <div className="text-sm text-gray-500">Players</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{games.length}</div>
              <div className="text-sm text-gray-500">Total Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {players.filter(p => getPlayerGames(p.id).length > 0).length}
              </div>
              <div className="text-sm text-gray-500">With Games</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {(games.reduce((sum, g) => sum + g.projection, 0) / games.length || 0).toFixed(1)}
              </div>
              <div className="text-sm text-gray-500">Avg Projection</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

