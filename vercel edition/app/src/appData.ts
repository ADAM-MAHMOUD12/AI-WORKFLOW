import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { API_BASE, apiFetch } from "./api";
const identity = <T,>(value: T) => value;

type AppDataRecord = { value: unknown; updated_at: string };
type AppDataResponse = { records: Record<string, AppDataRecord> };
const memoryCache = new Map<string, unknown>();

export function clearAppDataCache() {
  memoryCache.clear();
}

export function getCachedAppData<T>(key: string, fallback: T): T {
  return memoryCache.has(key) ? memoryCache.get(key) as T : fallback;
}

async function readRecords(): Promise<AppDataResponse> {
  const response = await apiFetch(`${API_BASE}/api/data`);
  if (!response.ok) throw new Error(`تعذّر تحميل قاعدة البيانات (${response.status}).`);
  return response.json() as Promise<AppDataResponse>;
}

export async function writeAppData(key: string, value: unknown) {
  const response = await apiFetch(`${API_BASE}/api/data/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error(`تعذّر حفظ «${key}» في قاعدة البيانات (${response.status}).`);
  memoryCache.set(key, value);
}

async function loadOrMigrate<T>(key: string, fallback: T, legacyKeys: string[], toStoredValue: (value: T) => unknown) {
  const result = await readRecords();
  const stored = result.records[key];
  if (stored) {
    memoryCache.set(key, stored.value);
    for (const legacyKey of legacyKeys) localStorage.removeItem(legacyKey);
    return stored.value as T;
  }

  await writeAppData(key, toStoredValue(fallback));
  for (const legacyKey of legacyKeys) localStorage.removeItem(legacyKey);
  return fallback;
}

export function usePersistentAppData<T>(
  key: string,
  fallback: T | (() => T),
  legacyKeys: string[] = [],
  toStoredValue: (value: T) => unknown = identity,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const legacyKeysRef = useRef(legacyKeys);
  const fallbackRef = useRef(value);
  const hydratedRef = useRef(false);
  fallbackRef.current = value;

  useEffect(() => {
    let active = true;
    void loadOrMigrate(key, fallbackRef.current, legacyKeysRef.current, toStoredValue)
      .then((loaded) => {
        if (!active) return;
        hydratedRef.current = true;
        setValue(loaded);
        setBackendAvailable(true);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        console.error(`تعذّر الاتصال بقاعدة البيانات لتحميل ${key}:`, reason);
        setBackendAvailable(false);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, [key, toStoredValue]);

  useEffect(() => {
    if (!ready || !backendAvailable || !hydratedRef.current) return;
    const timer = window.setTimeout(() => {
      void writeAppData(key, toStoredValue(value)).catch((reason: unknown) => {
        console.error(`تعذّر حفظ ${key} في قاعدة البيانات:`, reason);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [key, ready, backendAvailable, value]);

  return [value, setValue, ready];
}
