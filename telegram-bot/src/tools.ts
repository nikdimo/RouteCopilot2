import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { ToolDef } from "./types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function run(cmd: string, cwd: string = REPO_ROOT): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
    }).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(out || err.message || "Command failed");
  }
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "run_shell",
    description: "Run a shell command in the project repo (Windows or Linux). Use for git, npm, eas, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Full command to run, e.g. git status or npx eas build --platform ios --profile production --non-interactive" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read contents of a file in the repo (relative path from repo root).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path, e.g. app.json or src/screens/MapScreen.tsx" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List files and folders in a directory (relative path from repo root).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path, e.g. src or ." },
      },
      required: ["path"],
    },
  },
  {
    name: "git_status",
    description: "Show git status (branch, modified/untracked files).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "git_pull",
    description: "Pull latest from remote (origin).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "git_commit_push",
    description: "Commit all changes and push to current branch. Use for committing and pushing to GitHub.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
      },
      required: ["message"],
    },
  },
  {
    name: "bump_ios_build",
    description: "Increment iOS build number in app.json (run before EAS iOS build).",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "eas_build_ios",
    description: "Start EAS iOS production build (runs in Expo cloud). Returns immediately with build URL (does not wait for build to finish). Bump build number first if needed. After running, tell the user the build link and ask: when the build is done, do they want to submit to TestFlight or take any other actions (e.g. Apple login)?",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "eas_submit_ios_testflight",
    description: "Submit the latest iOS build to TestFlight. Run after eas_build_ios has completed (user confirms build finished).",
    parameters: { type: "object", properties: {} },
  },
];

export function executeTool(name: string, args: Record<string, unknown>): string {
  const safePath = (p: string) => {
    const full = path.resolve(REPO_ROOT, p);
    if (!full.startsWith(REPO_ROOT)) throw new Error("Path outside repo");
    return full;
  };

  switch (name) {
    case "run_shell": {
      const command = args.command as string;
      if (!command) throw new Error("command required");
      return run(command);
    }
    case "read_file": {
      const filePath = args.path as string;
      const full = safePath(filePath);
      return fs.readFileSync(full, "utf-8");
    }
    case "list_dir": {
      const dirPath = (args.path as string) || ".";
      const full = safePath(dirPath);
      return fs.readdirSync(full).join("\n");
    }
    case "git_status":
      return run("git status -sb");
    case "git_pull":
      return run("git pull --rebase");
    case "git_commit_push": {
      const message = args.message as string;
      if (!message) throw new Error("message required");
      run("git add -A");
      run(`git commit -m ${JSON.stringify(message)}`);
      return run("git push");
    }
    case "bump_ios_build":
      return run("node scripts/bump-ios-build.js");
    case "eas_build_ios":
      return run("npx eas build --platform ios --profile production --non-interactive --no-wait");
    case "eas_submit_ios_testflight":
      return run("npx eas submit --platform ios --profile production --latest --non-interactive");
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
