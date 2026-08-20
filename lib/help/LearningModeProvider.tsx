"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useAuth } from "@/lib/auth/AuthProvider";
import {
  getMyUserPreferences,
  setMyLearningMode,
} from "@/components/services/userPreferences.service";

interface LearningModeContextValue {
  /** DB-backed preference. false while loading / signed out. */
  learningMode: boolean;
  /** True until the first preference fetch finishes for the current user. */
  loading: boolean;
  setLearningMode: (enabled: boolean) => Promise<void>;
}

const LearningModeContext = createContext<LearningModeContextValue | null>(
  null
);

/**
 * Reads/writes public.user_preferences.learning_mode.
 * Does NOT default existing users to ON — only the DB value is used.
 */
export function LearningModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [learningMode, setLearningModeState] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setLearningModeState(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    getMyUserPreferences()
      .then((prefs) => {
        if (cancelled) return;
        // Missing row → treat as OFF (existing-user safe). Do not force ON.
        setLearningModeState(prefs?.learningMode ?? false);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setLearningModeState(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const setLearningMode = useCallback(async (enabled: boolean) => {
    const saved = await setMyLearningMode(enabled);
    setLearningModeState(saved.learningMode);
  }, []);

  return (
    <LearningModeContext.Provider
      value={{ learningMode, loading, setLearningMode }}
    >
      {children}
    </LearningModeContext.Provider>
  );
}

export function useLearningMode(): LearningModeContextValue {
  const ctx = useContext(LearningModeContext);
  if (!ctx) {
    throw new Error("useLearningMode must be used within LearningModeProvider");
  }
  return ctx;
}
