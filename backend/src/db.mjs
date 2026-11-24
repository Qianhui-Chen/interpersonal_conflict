import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createDatabase(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      condition TEXT NOT NULL,
      pace TEXT NOT NULL CHECK (pace IN ('fast', 'slow')),
      disclosure_enabled INTEGER NOT NULL CHECK (disclosure_enabled IN (0, 1)),
      completion_code TEXT NOT NULL,
      current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round BETWEEN 0 AND 6),
      in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight IN (0, 1)),
      in_flight_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      condition TEXT NOT NULL,
      round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 6),
      user_message TEXT NOT NULL,
      generated_acknowledgment TEXT,
      generated_disclosure TEXT,
      fixed_question TEXT NOT NULL,
      api_latency_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id),
      UNIQUE (session_id, round_number)
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session_round
      ON turns(session_id, round_number);

    UPDATE sessions SET in_flight = 0, in_flight_at = NULL WHERE in_flight = 1;
  `);

  const turnColumns = db.prepare("PRAGMA table_info(turns)").all();
  if (!turnColumns.some((column) => column.name === "generated_acknowledgment")) {
    db.exec("ALTER TABLE turns ADD COLUMN generated_acknowledgment TEXT");
  }

  const statements = {
    createSession: db.prepare(`
      INSERT INTO sessions (
        session_id, condition, pace, disclosure_enabled,
        completion_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    getSession: db.prepare(`
      SELECT session_id, condition, pace, disclosure_enabled,
             completion_code, current_round, in_flight,
             completed_at, created_at
      FROM sessions WHERE session_id = ?
    `),
    getTurns: db.prepare(`
      SELECT round_number, user_message, generated_acknowledgment, generated_disclosure,
             fixed_question, api_latency_ms, created_at
      FROM turns WHERE session_id = ? ORDER BY round_number ASC
    `),
    claimSession: db.prepare(`
      UPDATE sessions
      SET in_flight = 1, in_flight_at = ?
      WHERE session_id = ? AND in_flight = 0 AND current_round < 6
    `),
    releaseSession: db.prepare(`
      UPDATE sessions SET in_flight = 0, in_flight_at = NULL
      WHERE session_id = ?
    `),
    insertTurn: db.prepare(`
      INSERT INTO turns (
        session_id, condition, round_number, user_message,
        generated_acknowledgment, generated_disclosure, fixed_question, api_latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    advanceSession: db.prepare(`
      UPDATE sessions
      SET current_round = ?, in_flight = 0, in_flight_at = NULL,
          completed_at = ?
      WHERE session_id = ?
    `),
  };

  function readSession(sessionId) {
    const session = statements.getSession.get(sessionId);
    if (!session) return null;
    return {
      ...session,
      disclosure_enabled: Boolean(session.disclosure_enabled),
      in_flight: Boolean(session.in_flight),
      turns: statements.getTurns.all(sessionId),
    };
  }

  return {
    createSession(session) {
      statements.createSession.run(
        session.sessionId,
        session.condition,
        session.pace,
        session.disclosure ? 1 : 0,
        session.completionCode,
        session.createdAt,
      );
      return readSession(session.sessionId);
    },

    readSession,

    claimNextRound(sessionId, claimedAt) {
      const result = statements.claimSession.run(claimedAt, sessionId);
      if (result.changes !== 1) return null;
      const session = statements.getSession.get(sessionId);
      return { session, roundNumber: session.current_round + 1 };
    },

    release(sessionId) {
      statements.releaseSession.run(sessionId);
    },

    completeRound(turn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        statements.insertTurn.run(
          turn.sessionId,
          turn.condition,
          turn.roundNumber,
          turn.userMessage,
          turn.generatedAcknowledgment,
          turn.generatedDisclosure,
          turn.fixedQuestion,
          turn.apiLatencyMs,
          turn.createdAt,
        );
        statements.advanceSession.run(
          turn.roundNumber,
          turn.roundNumber === 6 ? turn.createdAt : null,
          turn.sessionId,
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        statements.releaseSession.run(turn.sessionId);
        throw error;
      }
      return readSession(turn.sessionId);
    },
  };
}
