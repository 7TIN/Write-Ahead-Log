import { Hono } from "hono";
import { error } from "node:console";
import { open, read, readFile, readFileSync, writeFile } from "node:fs";
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

app.get("/", (e) => {
  return e.json({
    status: 200,
    message: "woking",
  });
});

app.post("/", async (e) => {

  SimulateCrash("before wal")
  
  const result = await WriteData({
    op: "insert",
    table: "users",
    id: 2,
    name: "Prasad",
    email: "prasad@gmail",
  });

  SimulateCrash("after wal crash");

  console.log(result);

  if (result) {
    return e.json({
      status: 200,
      result: result,
    });
  }
});

app.post("/sync", async (e) => {
  await recoverWithWAL();
  return e.text("lets see");
});

const SimulateCrash = (point : string) => {

  if (Math.random() < 0.4) {
    console.log(`Crash at ${point}`)
    process.exit(1);

  }

}

const database = new Map();

const WriteData = async ({
  op,
  table,
  id,
  name,
  email,
}: {
  op: string;
  table: string;
  id: number;
  name: string;
  email: string;
}) => {
  readFile(path, "utf8", (err, data) => {
    if (err?.code === "ENOENT") {
      writeFile(path, "", () => {
        console.log("file written");
      });
    }
  });

  const txId = Date.now();
  // const txId = 1;

  // const data = `{tx: ${txId}, op: "insert", table : "users", id : "1", name : "prasad", email: "prasad@gmail.com"}`;

  // const data = `{tx:${txId}, op:${op}, table:${table}, id:${id}, name:${name}, email:${email}}`;
  const data = {
    tx: txId,
    op: op,
    table: table,
    id: id,
    name: name,
    email: email,
  };

  try {
    await appendFile(path, `{"tx":${txId},"op":"BEGIN"}` + "\n");
    await appendFile(path, `${JSON.stringify(data)}` + "\n");
    await appendFile(path, `{"tx":${txId},"op":"COMMIT"}` + "\n");
  } catch (err) {
    return;
  }
  database.set(txId, data);
  // console.log(data);
  return "file written";
};

const recoverWithWAL = async () => {
  try {
    const data = readFileSync(path, "utf8");

    if (!data || data === undefined) {
      console.log("file does not exists or its empty");
      return "no wal file";
    }
    let txOp = "";

    const ListOfTx = data.trim().split("\n").filter(Boolean);

    ListOfTx.forEach((tx) => {
      // console.log(tx);
      const parsedTx = JSON.parse(tx);

      // console.log(parsedTx)
      if (parsedTx.op === "BEGIN") {
        txOp = "BEGIN";
      } else if (
        parsedTx.op !== "COMMIT" &&
        parsedTx.op === "insert" &&
        txOp === "BEGIN"
      ) {
        // pendingTx.push(tx);
        database.set(parsedTx.tx, parsedTx);
      } else {
        txOp = "";
      }
    });
    // console.log(pendingTx);
    console.log(database);
  } catch (err) {
    return err;
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
