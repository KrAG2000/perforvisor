import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BusinessDetail, BusinessSummary } from "@perforvisor/core";
import { api } from "./lib/api.ts";

interface BusinessesContextValue {
  businesses: BusinessSummary[] | null;
  /** The owner's own businesses (not competitors). */
  owned: BusinessSummary[];
  selectedKey: string | null;
  select(key: string): void;
  detail: BusinessDetail | null;
  error: string | null;
  /** Re-fetches the list and the selected business. */
  refresh(): Promise<void>;
}

const BusinessesContext = createContext<BusinessesContextValue | null>(null);
const STORAGE_KEY = "perforvisor-client-business";

const readSelected = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export function BusinessesProvider({ children }: { children: ReactNode }) {
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(readSelected);
  const [detail, setDetail] = useState<BusinessDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owned = useMemo(
    () => (businesses ?? []).filter((b) => b.role === "business"),
    [businesses],
  );

  // Fall back to the first owned business when the stored one is gone.
  const effectiveKey = useMemo(() => {
    if (!businesses) return selectedKey;
    if (
      selectedKey &&
      businesses.some((b) => b.key === selectedKey && b.role === "business")
    )
      return selectedKey;
    return owned[0]?.key ?? null;
  }, [businesses, owned, selectedKey]);

  const refresh = useCallback(async () => {
    try {
      const list = await api.businesses();
      setBusinesses(list);
      setError(null);
      const key =
        effectiveKey && list.some((b) => b.key === effectiveKey)
          ? effectiveKey
          : list.find((b) => b.role === "business")?.key;
      setDetail(key ? await api.business(key) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Perforvisor.");
    }
  }, [effectiveKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While anything is syncing, keep the sidebar and pages current.
  const syncing = (businesses ?? []).some(
    (b) => b.sync.state === "queued" || b.sync.state === "running",
  );
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [syncing, refresh]);

  const select = useCallback((key: string) => {
    setSelectedKey(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Selection just won't persist.
    }
  }, []);

  const value: BusinessesContextValue = {
    businesses,
    owned,
    selectedKey: effectiveKey,
    select,
    detail: detail && detail.business.key === effectiveKey ? detail : null,
    error,
    refresh,
  };
  return (
    <BusinessesContext.Provider value={value}>
      {children}
    </BusinessesContext.Provider>
  );
}

export function useBusinesses(): BusinessesContextValue {
  const value = useContext(BusinessesContext);
  if (!value)
    throw new Error("useBusinesses must be used inside <BusinessesProvider>");
  return value;
}
