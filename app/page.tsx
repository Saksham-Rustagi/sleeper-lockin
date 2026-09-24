import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Hero Section */}
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight text-gray-900 dark:text-white">
              Sleeper Lock-In Optimizer
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-300">
              Maximize your fantasy basketball points with intelligent daily start and lock decisions
            </p>
          </div>

          {/* Feature Cards */}
          <div className="grid md:grid-cols-3 gap-6 mt-12">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🎯 Smart Matching</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Advanced bipartite matching algorithm optimizes player-slot assignments based on projections and scarcity
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🔒 Lock Decisions</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Real-time recommendations on when to lock a game result vs. waiting for future opportunities
                </CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">📊 What-If Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>
                  Compare policy vs. exact DP solutions, adjust risk tolerance, and simulate different scenarios
                </CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* Lock-In Rules */}
          <Card className="text-left mt-12">
            <CardHeader>
              <CardTitle>How Lock-In Mode Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <strong>1. Weekly Roster Lock:</strong> Each starting slot must have exactly one locked game by week's end.
              </p>
              <p>
                <strong>2. Per-Player Lock:</strong> A player can only be locked to one slot for the entire week.
              </p>
              <p>
                <strong>3. Tip-Off Locking:</strong> Players must be in the starting lineup at tip-off to be eligible for lock.
              </p>
              <p>
                <strong>4. Sequential Locking:</strong> You can only lock the most recent finished game for a player.
              </p>
              <p>
                <strong>5. Position Eligibility:</strong> Player must be eligible for the slot you're locking them to.
              </p>
            </CardContent>
          </Card>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mt-12">
            <Link href="/setup?source=sleeper">
              <Button size="lg" className="w-full sm:w-auto">
                Import from Sleeper
              </Button>
            </Link>
            <Link href="/setup?source=file">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Upload CSV/JSON
              </Button>
            </Link>
            <Link href="/setup?source=demo">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Try Demo Data
              </Button>
            </Link>
          </div>

          {/* Info */}
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-8">
            Built for Sleeper fantasy basketball Lock-In mode. All data stored locally in your browser.
          </p>
        </div>
      </div>
    </div>
  );
}
