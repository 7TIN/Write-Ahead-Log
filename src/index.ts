import { Hono } from "hono";
import { error } from "node:console";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { appendFile } from "node:fs/promises";
// import { readFile } from "node:fs/promises";

type Query = {
  // tx : number,
  op: "insert" | "update" | "delete";
  table: "users";
  id: number;
  name: string;
  email: string;
};

const app = new Hono();

const root = process.cwd();
const path = `${root}/wal.log`;

const database = new Map<
  number,
  Omit<Query, "op" | "table"> & { tx: number }
>();

app.get("/", (e) => {
  return e.json({
    status: 200,
    message: "woking",
  });
});

app.post("/", async (e) => {
  const body = await e.req.json().catch(() => ({}));

  const query: Query = {
    op: "insert",
    table: "users",
    id: body.id ?? 1,
    name: body.name ?? "Prasad",
    email: body.email ?? "prasad@gmail",
  };

  // SimulateCrash("before wal");

  const result = WriteData(query);

  SimulateCrash("after wal");

  return e.json({
    status: 200,
    result: result,
  });
});

app.post("/sync", async (e) => {
  database.clear();
  recoverWithWAL();
  return e.text("lets see");
});

const SimulateCrash = (point: string) => {
  if (Math.random() < 0.4) {
    console.log(`Crash at ${point}`);
    process.abort();
  }
};

const WriteData = (query: Query) => {
  const txId = Date.now();

  const walRecord = [
    { tx: txId, op: "BEGIN" },
    { tx: txId, ...query },
    { tx: txId, op: "COMMIT" },
  ];

  const recordBlock = walRecord.map((r) => JSON.stringify(r) + "\n").join("");

  // console.log(recordBlock);

  const fd = openSync(path, "a");

  // writeFileSync(fd, recordBlock);
  writeSync(fd, recordBlock);
  // process.abort();
  fsyncSync(fd);

  // process.abort();
  // SimulateCrash("before flush");

  closeSync(fd);

  database.set(query.id, { ...query, tx: txId });

  return {
    txId,
    Commited: true,
    data: query,
  };
};

const recoverWithWAL = async () => {
  try {
    const data = readFileSync(path, "utf8");

    if (!data || data === undefined) {
      console.log("file does not exists or its empty");
      return "no wal file";
    }
    let txOp = "";

    const pendingTx = new Map();
    const listOfRecords = data.trim().split("\n").filter(Boolean);

    for (const recordTx of listOfRecords) {
      const record = JSON.parse(recordTx);

      if (record.op === "BEGIN") {
        pendingTx.set(record.tx, null);
      } else if (record.op === "COMMIT") {
        const data = pendingTx.get(record.tx);
        if (data) {
          database.set(data.id, data);
        }
        pendingTx.delete(record.tx);
      } else {
        if (pendingTx.has(record.tx)) {
          pendingTx.set(record.tx, record);
        }
      }
    }

    console.log("Recovered from WAL:", Object.fromEntries(database));
  } catch (err: any) {
    if (err.code === "ENOENT") {
      console.log("No Wal File");
    } else {
      console.error("Recovery failed:", err);
    }
  }
};

// const ReadData = async () => {
//   //       try {
//   //     const data = await readFile(path, "utf8");
//   //     return data;
//   //   } catch (err: any) {
//   //     if (err?.code === "ENOENT") {
//   //       return "file does not exists";
//   //     }
//   //   }
// };

// const UpdateData = () => {};

// const DeleteData = () => {};

recoverWithWAL();
Bun.serve({
  port: 3000,
  fetch: app.fetch,
});

console.log(`server is running on http://localhost:3000`);
