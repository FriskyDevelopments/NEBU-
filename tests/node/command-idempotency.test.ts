import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { createCommand, IdempotencyConflictError } from "../../server/nebulosa/service";
import { nebulosaState } from "../../server/nebulosa/state";

const commandInput = {
  type: "session.mute_all" as const,
  payload: {
    sessionId: "session-main",
    reason: "Retry test",
    metadata: {
      source: "test",
    },
  },
  ttlSeconds: 60,
};

describe("createCommand idempotency", () => {
  beforeEach(() => {
    nebulosaState.commands.clear();
    nebulosaState.commandIdempotency.clear();
    nebulosaState.audit = [];
  });

  it("returns the original command when the same requester retries", () => {
    const first = createCommand("telegram:42", commandInput, "chat:7:message:9");
    const retry = createCommand("telegram:42", commandInput, "chat:7:message:9");

    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(retry.command.id, first.command.id);
    assert.equal(nebulosaState.commands.size, 1);
    assert.equal(nebulosaState.audit.filter((event) => event.event === "command.created").length, 1);
  });

  it("scopes an idempotency key to the requester", () => {
    const first = createCommand("telegram:42", commandInput, "message:9");
    const second = createCommand("telegram:84", commandInput, "message:9");

    assert.notEqual(second.command.id, first.command.id);
    assert.equal(nebulosaState.commands.size, 2);
  });

  it("rejects reusing a key for a different command", () => {
    createCommand("telegram:42", commandInput, "message:9");

    assert.throws(
      () => createCommand("telegram:42", { ...commandInput, type: "session.lock_room" }, "message:9"),
      IdempotencyConflictError,
    );
    assert.equal(nebulosaState.commands.size, 1);
  });
});
