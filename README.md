# expo-sqlite shared-prepared-statement corruption repro

Minimal reproduction for https://github.com/expo/expo — `expo-sqlite@57.0.2`.

Two reads issued concurrently over **one** prepared statement (`prepareAsync`)
corrupt each other's result sets: one reader's `getAllAsync()` steps rows bound
by another reader's `run`. `step`/`getAll`/`reset` don't take the per-statement
lock that `run` does, and `getAllAsync()` is a second native call after `run`'s
`await`, so the per-call lock cannot cover a cursor's run -> getAll pair.

## Run

```
npm install
npx expo run:ios --configuration Release
```

Release embeds the JS bundle, so no Metro is needed. The repro is in `App.tsx`.

## Observed (iPhone 17 Pro sim, iOS 26, expo-sqlite 57.0.2, RN 0.86.3, Release)

```
SERIALIZED  A(a/1)=["A1"]  B(b/1)=["B1"]
CONCURRENT  {"a/1":["A1"],"a/2":["A2","B3"],"a/3":["A3","B3"],"b/1":["B1","B3"],"b/2":["B2","B3"],"b/3":["B3","B3"]}
RESULT: CORRUPTED — 5/6 reads wrong
```

Each read that should return a single row gets another reader's row (`"B3"`)
leaked in. The serialized control is correct.

## Root cause (shipped source)

- `android/src/main/java/expo/modules/sqlite/SQLiteModule.kt`: `run` wraps
  reset+bind+step in `synchronized(statement)` ("stateful … critical section for
  thread safety"); `step`/`getAll`/`reset` take no lock.
- `ios/SQLiteModule.swift`: identical — `run` takes `statement.lock`;
  `step`/`getAll`/`reset` take none.
