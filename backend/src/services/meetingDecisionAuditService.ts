import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type AppendMeetingDecisionAuditInput = {
  userId: string;
  entry: unknown;
};

const AUDIT_LOG_DIR = path.resolve(process.cwd(), "logs");
const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "meeting_decision_audit.ndjson");

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function appendMeetingDecisionAuditLog(input: AppendMeetingDecisionAuditInput) {
  const entryObject = asObject(input.entry);
  const bookedMeeting = entryObject ? asObject(entryObject.bookedMeeting) : null;
  const selected = entryObject ? asObject(entryObject.selected) : null;

  const loggedAtIso = new Date().toISOString();
  const record = {
    loggedAtIso,
    userId: input.userId,
    code: entryObject ? asString(entryObject.code) : null,
    meetingTitle: bookedMeeting ? asString(bookedMeeting.title) : null,
    meetingTitleBase: bookedMeeting ? asString(bookedMeeting.titleBase) : null,
    selectedProposalId: selected ? asString(selected.proposalId) : null,
    selectedDayIso: selected ? asString(selected.dayIso) : null,
    entry: input.entry,
  };

  await mkdir(AUDIT_LOG_DIR, { recursive: true });
  await appendFile(AUDIT_LOG_FILE, `${JSON.stringify(record)}\n`, "utf8");

  return {
    loggedAtIso,
    filePath: AUDIT_LOG_FILE,
  };
}
