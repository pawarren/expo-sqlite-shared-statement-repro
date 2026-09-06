// Minimal expo-sqlite reproduction — no other dependency.
//
// Drop this in as App.tsx of a fresh app:
//   npx create-expo-app@latest sqlite-stmt-repro --template blank-typescript
//   cd sqlite-stmt-repro && npx expo install expo-sqlite
//   (replace App.tsx with this file)
//   npx expo run:android      # or run:ios — a dev build, not Expo Go
//
// What it shows: ONE prepared statement, shared by two reads issued
// concurrently, corrupts each other's results. Reader A asks for keys a/1..a/3
// and reader B for b/1..b/3; because getAllAsync() is a second native call made
// after run()'s await, reader B's run() rebinds the shared statement inside
// reader A's await gap, and A's getAllAsync() then steps B's rows. Expected: two
// clean disjoint result sets. Actual on 57.x: rows go missing / cross over.

import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import * as SQLite from "expo-sqlite";

export default function App() {
  const [lines, setLines] = useState<string[]>([]);
  const log = (s: string) => setLines((prev) => [...prev, s]);

  useEffect(() => {
    (async () => {
      const db = await SQLite.openDatabaseAsync("repro.db");
      await db.execAsync(
        "DROP TABLE IF EXISTS kv; CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);"
      );
      for (const [k, v] of [
        ["a/1", "A1"], ["a/2", "A2"], ["a/3", "A3"],
        ["b/1", "B1"], ["b/2", "B2"], ["b/3", "B3"],
      ]) {
        await db.runAsync("INSERT INTO kv (k, v) VALUES (?, ?)", k, v);
      }

      // ONE prepared statement, shared by both readers — the shape a store
      // layer (e.g. a KV cache keyed by SQL text) naturally produces.
      const stmt = await db.prepareAsync("SELECT v FROM kv WHERE k = ?");

      // read() = executeForRawResultAsync (native run: reset+bind+step-one),
      // await, then getAllAsync (a SECOND native call stepping the rest).
      const read = async (key: string) => {
        const cursor = await stmt.executeAsync<{ v: string }>(key);
        const rows = await cursor.getAllAsync();
        await cursor.resetAsync();
        return rows.map((r) => r.v);
      };

      // Serialized control — always correct.
      const ctrlA = await read("a/1");
      const ctrlB = await read("b/1");
      log(`SERIALIZED  A(a/1)=${JSON.stringify(ctrlA)}  B(b/1)=${JSON.stringify(ctrlB)}`);

      // Concurrent — two reads on the one shared statement at once.
      const [gotA1, gotA2, gotA3, gotB1, gotB2, gotB3] = await Promise.all([
        read("a/1"), read("a/2"), read("a/3"),
        read("b/1"), read("b/2"), read("b/3"),
      ]);
      const got = { "a/1": gotA1, "a/2": gotA2, "a/3": gotA3, "b/1": gotB1, "b/2": gotB2, "b/3": gotB3 };
      log(`CONCURRENT  ${JSON.stringify(got)}`);

      const wrong = Object.entries(got).filter(([k, v]) => {
        const expected = k[0].toUpperCase() + k[2]; // a/1 -> A1
        return v.length !== 1 || v[0] !== expected;
      });
      log(
        wrong.length === 0
          ? "RESULT: OK — no cross-wire"
          : `RESULT: CORRUPTED — ${wrong.length}/6 reads wrong: ${wrong
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(", ")}`
      );

      await stmt.finalizeAsync();
    })().catch((e) => log("THREW: " + String(e)));
  }, []);

  return (
    <ScrollView style={{ marginTop: 60, padding: 16 }}>
      {lines.map((l, i) => (
        <Text key={i} style={{ fontFamily: "monospace", marginBottom: 12 }}>
          {l}
        </Text>
      ))}
    </ScrollView>
  );
}
