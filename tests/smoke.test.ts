import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT_DIR = path.resolve(import.meta.dir, "..");

// ── Bridge scripts exist ──────────────────────────────────────────────────

describe("bridge scripts", () => {
  for (const script of ["bridge.js", "codex-bridge.js", "gemini-bridge.js"]) {
    test(`${script} exists`, () => {
      expect(fs.existsSync(path.join(PROJECT_DIR, script))).toBe(true);
    });
  }
});

// ── Env validation logic ──────────────────────────────────────────────────

describe("env validation", () => {
  test("bridge.js exits with error if no TELEGRAM_BOT_TOKEN", () => {
    const result = spawnSync("bun", [path.join(PROJECT_DIR, "bridge.js")], {
      timeout: 10000,
      env: { ...process.env, TELEGRAM_BOT_TOKEN: "", OWNER_TELEGRAM_ID: "123" },
    });
    expect(result.status).toBe(1);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("TELEGRAM_BOT_TOKEN");
  });

  test("codex-bridge.js exits with error if no TELEGRAM_BOT_TOKEN", () => {
    const result = spawnSync("bun", [path.join(PROJECT_DIR, "codex-bridge.js")], {
      timeout: 10000,
      env: { ...process.env, TELEGRAM_BOT_TOKEN: "", OWNER_TELEGRAM_ID: "123" },
    });
    expect(result.status).toBe(1);
    const stderr = result.stderr.toString();
    expect(stderr).toContain("TELEGRAM_BOT_TOKEN");
  });
});

// ── Path convergence ──────────────────────────────────────────────────────

describe("path convergence", () => {
  test("codex-bridge.js uses import.meta.url-based paths (not hardcoded HOME)", () => {
    const src = fs.readFileSync(path.join(PROJECT_DIR, "codex-bridge.js"), "utf-8");
    // Should use import.meta.url or DATA_DIR, not hardcoded ~/Projects/...
    expect(src).not.toContain('join(process.env.HOME, "Projects/telegram-cli-bridge');
    expect(src).toContain("CODEX_BRIDGE_DATA_DIR");
  });

  test("codex-bridge.js respects CODEX_BRIDGE_HISTORY_FILE env", () => {
    const src = fs.readFileSync(path.join(PROJECT_DIR, "codex-bridge.js"), "utf-8");
    expect(src).toContain("CODEX_BRIDGE_HISTORY_FILE");
  });

  test("codex-bridge.js respects CODEX_BRIDGE_FILE_DIR env", () => {
    const src = fs.readFileSync(path.join(PROJECT_DIR, "codex-bridge.js"), "utf-8");
    expect(src).toContain("CODEX_BRIDGE_FILE_DIR");
  });
});

// ── .gitignore security ──────────────────────────────────────────────────

describe("security", () => {
  test(".gitignore excludes .env files", () => {
    const gitignore = fs.readFileSync(path.join(PROJECT_DIR, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env");
  });

  test(".gitignore excludes session files", () => {
    const gitignore = fs.readFileSync(path.join(PROJECT_DIR, ".gitignore"), "utf-8");
    expect(gitignore).toContain("sessions.json");
  });

  test(".env.example exists as template", () => {
    expect(fs.existsSync(path.join(PROJECT_DIR, ".env.example"))).toBe(true);
  });
});

// ── Doctor script ─────────────────────────────────────────────────────────

describe("doctor.sh", () => {
  test("doctor script exists and is valid bash", () => {
    const doctorPath = path.join(PROJECT_DIR, "scripts", "doctor.sh");
    expect(fs.existsSync(doctorPath)).toBe(true);
    const content = fs.readFileSync(doctorPath, "utf-8");
    expect(content.startsWith("#!/bin/bash")).toBe(true);
  });
});
