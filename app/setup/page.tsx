"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { parseCSV, parseJSON } from "@/lib/parser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchUser, fetchUserLeagues, fetchRosters } from "@/lib/sleeper/api";
import { transformToWeekData } from "@/lib/sleeper/transform";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import GameScheduleEditor from "@/components/schedule/GameScheduleEditor";
import { GameProjection } from "@/types";

export default function SetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams.get("source") || "sleeper";
  const setWeekData = useStore((state) => state.setWeekData);

  const [loading, setLoading] = useState(false);
  const [sleeperUsername, setSleeperUsername] = useState("");
  const [sleeperUserId, setSleeperUserId] = useState("");
  const [sleeperLeagues, setSleeperLeagues] = useState<any[]>([]);
  const [selectedLeague, setSelectedLeague] = useState("");
  const [tempWeekData, setTempWeekData] = useState<any>(null);
  const [showScheduleEditor, setShowScheduleEditor] = useState(false);

  useEffect(() => {
    if (source === "demo") {
      loadDemoData();
    }
  }, [source]);

  const loadDemoData = async () => {
    try {
      setLoading(true);
      const response = await fetch("/mocks/week.sample.json");
      const data = await response.json();
      setWeekData(data);
      toast.success("Demo data loaded successfully!");
      router.push("/optimizer");
    } catch (error) {
      toast.error("Failed to load demo data");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      let data;
      
      if (file.name.endsWith(".csv")) {
        data = await parseCSV(file);
      } else if (file.name.endsWith(".json")) {
        data = await parseJSON(file);
      } else {
        throw new Error("Unsupported file type. Please upload CSV or JSON.");
      }

      setWeekData(data);
      toast.success("Data imported successfully!");
      router.push("/optimizer");
    } catch (error: any) {
      toast.error(error.message || "Failed to import data");
    } finally {
      setLoading(false);
    }
  };

  const handleSleeperImport = async () => {
    if (!sleeperUsername) {
      toast.error("Please enter a Sleeper username");
      return;
    }

    try {
      setLoading(true);
      const user = await fetchUser(sleeperUsername);
      setSleeperUserId(user.user_id); // Save user ID
      
      // Get current NBA season year
      // In October 2025, we're in the 2025-26 season, Sleeper calls it "2025"
      const currentYear = new Date().getFullYear(); // 2025
      const currentMonth = new Date().getMonth(); // 0-11, October = 9
      // NBA season runs Oct-June, so if Oct or later use current year, else previous
      const currentSeason = currentMonth >= 9 ? currentYear : currentYear - 1;
      
      // Fetch current season and previous season to show both
      const [currentLeagues, previousLeagues] = await Promise.all([
        fetchUserLeagues(user.user_id, "nba", currentSeason.toString()),
        fetchUserLeagues(user.user_id, "nba", (currentSeason - 1).toString()).catch(() => [])
      ]);
      
      const allLeagues = [...currentLeagues, ...previousLeagues];
      
      if (allLeagues.length === 0) {
        toast.error(`No NBA leagues found`);
        return;
      }

      // Sort: current season first, then by status (in_season > pre_draft > drafting > complete)
      const sortedLeagues = allLeagues.sort((a, b) => {
        // First sort by season (current year first)
        const seasonDiff = parseInt(b.season) - parseInt(a.season);
        if (seasonDiff !== 0) return seasonDiff;
        
        // Then by status
        const statusOrder = { in_season: 0, pre_draft: 1, drafting: 2, complete: 3 };
        const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 4;
        const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 4;
        return aOrder - bOrder;
      });

      setSleeperLeagues(sortedLeagues);
      toast.success(`Found ${allLeagues.length} league(s) for ${user.display_name || user.username}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to fetch Sleeper data");
    } finally {
      setLoading(false);
    }
  };

  const handleLeagueSelect = async (leagueId: string) => {
    setSelectedLeague(leagueId);

    try {
      setLoading(true);
      const league = sleeperLeagues.find(l => l.league_id === leagueId);
      if (!league) return;

      const rosters = await fetchRosters(leagueId);
      
      // Find the user's roster by matching owner_id
      const userRoster = rosters.find(r => r.owner_id === sleeperUserId);
      
      if (!userRoster) {
        toast.error("Could not find your roster in this league");
        return;
      }
      
      // Use current week dates
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
      weekStart.setHours(0, 0, 0, 0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);

      const weekData = await transformToWeekData(
        league,
        userRoster,
        weekStart.toISOString(),
        weekEnd.toISOString()
      );

      // Save to temp state and show schedule editor
      setTempWeekData(weekData);
      setShowScheduleEditor(true);
      toast.success(`Roster loaded! Now add game schedules for ${weekData.players.length} players`);
    } catch (error: any) {
      toast.error(error.message || "Failed to import league data");
    } finally {
      setLoading(false);
    }
  };

  const handleGamesUpdate = (games: GameProjection[]) => {
    if (tempWeekData) {
      setTempWeekData({
        ...tempWeekData,
        games
      });
    }
  };

  const handleFinishSetup = () => {
    if (!tempWeekData) {
      toast.error("No data to save");
      return;
    }

    if (tempWeekData.games.length === 0) {
      toast.error("Please add at least one game");
      return;
    }

    setWeekData(tempWeekData);
    toast.success("Week data saved!");
    router.push("/optimizer");
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Setup Your Week</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {showScheduleEditor 
              ? "Add game schedules and projections for each player"
              : "Import your roster and game data to get started"
            }
          </p>
        </div>

        {showScheduleEditor && tempWeekData ? (
          <div className="space-y-6">
            <GameScheduleEditor
              players={tempWeekData.players}
              games={tempWeekData.games}
              onGamesUpdate={handleGamesUpdate}
            />
            
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setShowScheduleEditor(false);
                  setTempWeekData(null);
                }}
              >
                ← Back
              </Button>
              <Button
                onClick={handleFinishSetup}
                size="lg"
                disabled={!tempWeekData.games || tempWeekData.games.length === 0}
              >
                Continue to Optimizer →
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Tabs defaultValue={source} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sleeper">Sleeper API</TabsTrigger>
                <TabsTrigger value="file">File Upload</TabsTrigger>
                <TabsTrigger value="demo">Demo</TabsTrigger>
              </TabsList>

          <TabsContent value="sleeper" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Import from Sleeper</CardTitle>
                <CardDescription>
                  Enter your Sleeper username to fetch your leagues and rosters
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Sleeper Username</Label>
                  <div className="flex gap-2">
                    <Input
                      id="username"
                      placeholder="Enter your username"
                      value={sleeperUsername}
                      onChange={(e) => setSleeperUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSleeperImport()}
                    />
                    <Button onClick={handleSleeperImport} disabled={loading}>
                      {loading ? "Loading..." : "Fetch Leagues"}
                    </Button>
                  </div>
                </div>

                {sleeperLeagues.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="league">Select League</Label>
                    <Select value={selectedLeague} onValueChange={handleLeagueSelect}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a league" />
                      </SelectTrigger>
                      <SelectContent>
                        {sleeperLeagues.map((league) => (
                          <SelectItem key={league.league_id} value={league.league_id}>
                            {league.name} - {league.season} ({league.status}) - {league.total_rosters} teams
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="file" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Upload CSV or JSON</CardTitle>
                <CardDescription>
                  Import your week data from a CSV or JSON file
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">Choose File</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".csv,.json"
                    onChange={handleFileUpload}
                    disabled={loading}
                  />
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  <p className="font-semibold mb-1">CSV Format:</p>
                  <code className="block bg-gray-100 dark:bg-gray-800 p-2 rounded text-xs">
                    player,positions,tipoffUtc,opponent,projection,variance,actual,status
                  </code>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="demo" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Demo Data</CardTitle>
                <CardDescription>
                  Try the optimizer with sample data (14 players, 30 games over 7 days)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={loadDemoData} disabled={loading} className="w-full">
                  {loading ? "Loading..." : "Load Demo Data"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
            </Tabs>

            <div className="mt-8">
              <Button variant="outline" onClick={() => router.push("/")}>
                ← Back to Home
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

