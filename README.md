# WAL — Write-Ahead Log from First Principles

A minimal, educational implementation of a **Write-Ahead Log (WAL)** built with **Bun**, **Hono**, and **Node.js `fs` primitives**. No database engine. No ORM. Just the core idea that keeps your data safe when the lights go out.

>**The Log is the Source of Truth. Everything else is derived state.**

---

## What is WAL?

Every serious database (PostgreSQL, MySQL/InnoDB, SQLite, Kafka, RocksDB) uses a **Write-Ahead Log** to survive crashes. Before any data is considered "saved," the database writes the *intention* to an append-only journal and forces it to physical disk. If the process, OS, or entire machine dies mid-operation, the database simply replays the log on restart and reconstructs a consistent state.

This project implements that exact mechanism — stripped down to its bones — so you can see how durability actually works.

---

## Architecture

<!-- ![Architecture Diagram](wal-architecture.png) -->

### Components

| Component | Role |
|-----------|------|
| **Hono API Server** | Receives HTTP requests and routes them to the WAL engine |
| **WAL Engine** | Builds transaction records, appends them to `wal.log`, and calls `fsyncSync()` |
| **In-Memory Database** | A `Map<number, Record>` for fast reads. Rebuilt from WAL on every startup |
| **wal.log** | The append-only journal. JSON Lines format. Survives crashes |
| **Recovery Engine** | Reads `wal.log` sequentially, verifies `BEGIN → data → COMMIT`, and restores committed transactions |

### The Durability Barrier

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ writeSync() │────▶│ fsyncSync() │────▶│   COMMIT    │
│  OS cache   │     │PHYSICAL DISK|     │  ACK to user│
└─────────────┘     └─────────────┘     └─────────────┘
        │
        ▼
   Crash here = LOST (correct)
```

`writeSync()` only writes to the **OS page cache** (RAM). `fsyncSync()` forces bytes to the **physical storage device**. Without `fsync`, a power loss destroys your data. This is the single most important lesson of WAL.

---

## Features

- **Append-Only WAL** — Sequential writes, no in-place edits
- **Crash Recovery** — Replays log on startup, skips uncommitted transactions
- **Transaction Semantics** — `BEGIN → operation → COMMIT` records
- **fsync Durability** — `fsyncSync()` guarantees physical disk persistence
- **Crash Simulation** — `process.abort()` and `SimulateCrash()` for deterministic testing
- **In-Memory Reads** — `Map` provides O(1) lookups; WAL provides durability
- **Checkpoint Ready** — Architecture supports Phase 2 snapshotting

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)

### Install & Run

```bash
# Clone the repo
git clone https://github.com/7TIN/Write-Ahead-Log
cd wal

# Install dependencies
bun install

# Start the server
bun run dev
```

Server starts at `http://localhost:3000`.

---

## API

### `GET /`

Returns the current in-memory database state.

```bash
curl http://localhost:3000
```

**Response:**
```json
{
  "status": 200,
  "database": {
    "2": {
      "tx": 1782842026999,
      "op": "insert",
      "table": "users",
      "id": 2,
      "name": "Prasad",
      "email": "prasad@gmail.com"
    }
  }
}
```

### `POST /`

Inserts a new record through the WAL.

```bash
curl -X POST http://localhost:3000   -H "Content-Type: application/json"   -d '{"id": 5, "name": "Alice", "email": "alice@example.com"}'
```

**What happens internally:**
1. Builds a 3-record WAL block: `BEGIN` → `insert` → `COMMIT`
2. `openSync(path, "a")` — append mode
3. `writeSync(fd, block)` — write to OS buffer
4. `fsyncSync(fd)` — **DURABILITY BARRIER**
5. `closeSync(fd)`
6. Update in-memory `Map`
7. Return success to client

### `POST /sync`

Manually triggers recovery from `wal.log` (useful for testing).

```bash
curl -X POST http://localhost:3000/sync
```

---

## Testing Crash Recovery

The server includes a `SimulateCrash()` function that randomly calls `process.abort()` at two critical points:

| Crash Point | Expected Behavior |
|-------------|-------------------|
| **Before `fsyncSync`** | Transaction is **lost**. WAL has no `COMMIT` on disk. Recovery ignores it. |
| **After `fsyncSync`** | Transaction **survives**. WAL has full `BEGIN → data → COMMIT`. Recovery replays it. |

### Manual Verification

1. Start the server: `bun run dev`
2. Send a POST request
3. If it crashes before fsync, restart and check `GET /` — the record should **not** exist
4. If it crashes after fsync, restart and check `GET /` — the record **must** exist

### Deterministic Recovery Test

Create a `wal.log` with partial and complete transactions:

```
{"tx":1,"op":"BEGIN"}
{"tx":1,"op":"insert","id":1,"name":"Lost","email":"lost@x.com"}
{"tx":2,"op":"BEGIN"}
{"tx":2,"op":"insert","id":2,"name":"Kept","email":"kept@x.com"}
{"tx":2,"op":"COMMIT"}
```

Restart the server. Only `id: 2` should appear in the database. `id: 1` has no `COMMIT` — correctly discarded.

---

## WAL File Format

`wal.log` uses **JSON Lines** (newline-delimited JSON). Each transaction produces 3 records:

```json
{"tx":1782842026999,"op":"BEGIN"}
{"tx":1782842026999,"op":"insert","table":"users","id":2,"name":"Prasad","email":"prasad@gmail.com"}
{"tx":1782842026999,"op":"COMMIT"}
```

This format is:
- **Human-readable** — open in any text editor
- **Append-only** — never edit existing lines
- **Self-describing** — each line is independent and parseable

---

## Core Principles

1. **Log is the source of truth.** The in-memory `Map` is a cache that can be rebuilt at any time.
2. **`writeSync` ≠ `fsync`.** `writeSync` puts data in OS RAM. `fsyncSync` puts it on the physical disk. Power loss eats anything not `fsync`'d.
3. **A transaction is committed only when its `COMMIT` record is fsync'd.** Before that, it is vapor.
4. **Recovery is deterministic.** Read the log from top to bottom. Apply only transactions with a matching `COMMIT`. Ignore everything else.
5. **In-memory state is ephemeral.** RAM is wiped on crash. The log is eternal (until checkpointed).

---