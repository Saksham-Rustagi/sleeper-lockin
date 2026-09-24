import { create } from "zustand";
import { persist } from "zustand/middleware";
import { WeekData, LockedSlot, Position, RiskMode } from "@/types";

interface AppState {
  // Core data
  weekData: WeekData | null;
  
  // Locked state - need to serialize Maps and Sets for persistence
  lockedSlots: Record<string, LockedSlot>;
  lockedPlayers: string[];
  
  // Simulation
  currentTime: string | null;
  
  // Settings
  riskMode: RiskMode;
  varianceLambda: number;
  
  // Actions
  setWeekData: (data: WeekData) => void;
  lockGame: (slot: Position, playerId: string, gameId: string, points: number) => void;
  unlockSlot: (slot: Position) => void;
  unlockAll: () => void;
  updateProjection: (gameId: string, projection: number) => void;
  updateActual: (gameId: string, actual: number) => void;
  updateGameStatus: (gameId: string, status: "UPCOMING" | "IN_PROGRESS" | "FINAL") => void;
  setRiskMode: (mode: RiskMode) => void;
  setVarianceLambda: (lambda: number) => void;
  setCurrentTime: (time: string | null) => void;
  reset: () => void;
}

const initialState = {
  weekData: null,
  lockedSlots: {},
  lockedPlayers: [],
  currentTime: null,
  riskMode: "neutral" as RiskMode,
  varianceLambda: 0,
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setWeekData: (data) => set({ weekData: data }),

      lockGame: (slot, playerId, gameId, points) => {
        const { lockedSlots, lockedPlayers } = get();
        set({
          lockedSlots: {
            ...lockedSlots,
            [slot]: { playerId, gameId, points },
          },
          lockedPlayers: [...lockedPlayers, playerId],
        });
      },

      unlockSlot: (slot) => {
        const { lockedSlots, lockedPlayers } = get();
        const locked = lockedSlots[slot];
        if (locked) {
          const newSlots = { ...lockedSlots };
          delete newSlots[slot];
          set({
            lockedSlots: newSlots,
            lockedPlayers: lockedPlayers.filter((id) => id !== locked.playerId),
          });
        }
      },

      unlockAll: () => set({ lockedSlots: {}, lockedPlayers: [] }),

      updateProjection: (gameId, projection) => {
        const { weekData } = get();
        if (!weekData) return;

        const games = weekData.games.map((g) =>
          g.gameId === gameId ? { ...g, projection } : g
        );

        set({ weekData: { ...weekData, games } });
      },

      updateActual: (gameId, actual) => {
        const { weekData } = get();
        if (!weekData) return;

        const games = weekData.games.map((g) =>
          g.gameId === gameId ? { ...g, actual, status: "FINAL" as const } : g
        );

        set({ weekData: { ...weekData, games } });
      },

      updateGameStatus: (gameId, status) => {
        const { weekData } = get();
        if (!weekData) return;

        const games = weekData.games.map((g) =>
          g.gameId === gameId ? { ...g, status } : g
        );

        set({ weekData: { ...weekData, games } });
      },

      setRiskMode: (mode) => set({ riskMode: mode }),

      setVarianceLambda: (lambda) => set({ varianceLambda: lambda }),

      setCurrentTime: (time) => set({ currentTime: time }),

      reset: () => set(initialState),
    }),
    {
      name: "sleeper-lockin-storage",
    }
  )
);

// Helper hooks for computed values
export function useLockedState() {
  const lockedSlots = useStore((state) => state.lockedSlots);
  const lockedPlayers = useStore((state) => state.lockedPlayers);

  return {
    lockedSlots: new Map(Object.entries(lockedSlots)) as Map<Position, LockedSlot>,
    lockedPlayers: new Set(lockedPlayers),
  };
}

export function useLockedTotal() {
  const lockedSlots = useStore((state) => state.lockedSlots);
  return Object.values(lockedSlots).reduce((sum, slot) => sum + slot.points, 0);
}

