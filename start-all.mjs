import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const applications = [
  { name: "frontend", cwd: new URL("./frontend/", import.meta.url) },
  { name: "backend", cwd: new URL("./backend/", import.meta.url) },
];

const children = applications.map(({ name, cwd }) => {
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: fileURLToPath(cwd),
    stdio: "inherit",
    env: process.env,
  });
  child.appName = name;
  return child;
});

let stopping = false;

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 250);
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(`${child.appName}启动失败：`, error);
    stopAll(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`${child.appName}意外退出（code=${code}, signal=${signal}）。`);
      stopAll(code || 1);
    }
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

console.log(`前后端启动器：${root}`);
