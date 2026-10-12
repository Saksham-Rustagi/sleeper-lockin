"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function HelpDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Help
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lock-In Mode Guide</DialogTitle>
          <DialogDescription>
            Learn how to use the optimizer and understand Lock-In rules
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Lock-In Rules */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Lock-In Rules</h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <div className="font-bold text-blue-600 min-w-[24px]">1.</div>
                <div>
                  <strong>Week End:</strong> Any starter you never lock gets his final game of the week automatically (0 if he doesn&apos;t play). Benching a player forfeits his last game.
                </div>
              </div>
              <div className="flex gap-3">
                <div className="font-bold text-blue-600 min-w-[24px]">2.</div>
                <div>
                  <strong>Per-Player Lock:</strong> A player can only be locked to one slot for the entire week. Once locked, all future games are ineligible.
                </div>
              </div>
              <div className="flex gap-3">
                <div className="font-bold text-blue-600 min-w-[24px]">3.</div>
                <div>
                  <strong>Tip-Off Locking:</strong> Players must be in the starting lineup at tip-off to be eligible for lock later.
                </div>
              </div>
              <div className="flex gap-3">
                <div className="font-bold text-blue-600 min-w-[24px]">4.</div>
                <div>
                  <strong>Sequential Locking:</strong> You can only lock the most recent finished game, before his next tip-off. A slot can be reused the same night once a player&apos;s game has ended.
                </div>
              </div>
              <div className="flex gap-3">
                <div className="font-bold text-blue-600 min-w-[24px]">5.</div>
                <div>
                  <strong>Position Eligibility:</strong> Player must be eligible for the slot you're locking them to.
                </div>
              </div>
            </div>
          </section>

          <Separator />

          {/* How the Optimizer Works */}
          <section>
            <h3 className="text-lg font-semibold mb-3">How the Optimizer Works</h3>
            <div className="space-y-3 text-sm">
              <div>
                <strong className="text-blue-600">Timeline View:</strong>
                <p className="mt-1">See all games chronologically. Get start recommendations at each tip-off using maximum-weight bipartite matching.</p>
              </div>
              <div>
                <strong className="text-blue-600">Live Decisions:</strong>
                <p className="mt-1">When a game finishes, the optimizer calculates whether to lock now or wait. It compares total points with lock vs. best expected remaining.</p>
              </div>
              <div>
                <strong className="text-blue-600">What-If Mode:</strong>
                <p className="mt-1">Edit projections and actuals. Compare policy results vs. exact DP solution (optimal if all actuals were known).</p>
              </div>
            </div>
          </section>

          <Separator />

          {/* Risk Modes */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Risk Modes</h3>
            <div className="space-y-2 text-sm">
              <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
                <strong>Conservative (ε = -2):</strong> Lock earlier for safety. Less likely to wait for better games.
              </div>
              <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                <strong>Neutral (ε = 0):</strong> Balanced approach. Lock when current ≥ expected remaining.
              </div>
              <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
                <strong>Aggressive (ε = +2):</strong> Wait for upside. Only lock if significantly better than waiting.
              </div>
            </div>
          </section>

          <Separator />

          {/* Algorithms */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Key Algorithms</h3>
            <div className="space-y-3 text-sm">
              <div>
                <strong className="text-blue-600">Hungarian Algorithm:</strong>
                <p className="mt-1">Solves maximum-weight bipartite matching. Assigns players to slots optimally with scarcity penalties.</p>
              </div>
              <div>
                <strong className="text-blue-600">Lock Decision Policy:</strong>
                <p className="mt-1">Computes delta: <code className="bg-gray-100 dark:bg-gray-800 px-1">total_with_lock - total_without_lock</code>. Locks if delta ≥ ε.</p>
              </div>
              <div>
                <strong className="text-blue-600">Exact DP Solver:</strong>
                <p className="mt-1">Dynamic programming with memoization. Finds global optimum assuming all actuals known. Timeout: 200ms.</p>
              </div>
            </div>
          </section>

          <Separator />

          {/* Tips */}
          <section>
            <h3 className="text-lg font-semibold mb-3">Pro Tips</h3>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li>Save scarce positions (C, PG) for high-value games</li>
              <li>Monitor variance: high variance = more upside potential</li>
              <li>Use What-If mode to test different scenarios</li>
              <li>Lock early in Conservative mode if uncertain about future</li>
              <li>Check DP solution to see optimal total if you had perfect info</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

