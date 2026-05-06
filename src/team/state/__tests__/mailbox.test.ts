import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  broadcast,
  listMailbox,
  markDelivered,
  markNotified,
  sendMessage,
} from "../mailbox.js";
import { writeWorkerIdentity } from "../workers.js";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "omghc-mailbox-test-"));
}

function seedWorker(
  dir: string,
  team: string,
  name: string,
  index: number,
): void {
  writeWorkerIdentity(
    { name, index, role: "x", team_name: team },
    { workingDirectory: dir },
  );
}

test("sendMessage creates a message file; listMailbox returns it", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sent = sendMessage(
    {
      team_name: "alpha",
      from_worker: "worker-1",
      to_worker: "worker-2",
      body: "ping",
    },
    { workingDirectory: dir },
  );
  assert.equal(typeof sent.message_id, "string");
  assert.notEqual(sent.message_id, "");
  assert.equal(sent.team_name, "alpha");
  assert.equal(sent.from_worker, "worker-1");
  assert.equal(sent.to_worker, "worker-2");
  assert.equal(sent.body, "ping");
  assert.equal(typeof sent.sent_at, "string");

  const inbox = listMailbox("alpha", "worker-2", { workingDirectory: dir });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]?.message_id, sent.message_id);

  // Sender's own mailbox is empty.
  assert.equal(
    listMailbox("alpha", "worker-1", { workingDirectory: dir }).length,
    0,
  );
});

test("broadcast creates one message per worker, excluding the sender", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Pre-register 3 workers under team alpha so the mailbox layer can discover them.
  seedWorker(dir, "alpha", "worker-1", 0);
  seedWorker(dir, "alpha", "worker-2", 1);
  seedWorker(dir, "alpha", "worker-3", 2);

  const delivered = broadcast(
    {
      team_name: "alpha",
      from_worker: "worker-1",
      body: "ALL HANDS",
    },
    { workingDirectory: dir },
  );
  assert.equal(delivered.length, 2);
  assert.deepEqual(
    delivered.map((m) => m.to_worker).sort(),
    ["worker-2", "worker-3"],
  );

  // Each recipient sees exactly one message.
  for (const recipient of ["worker-2", "worker-3"]) {
    const inbox = listMailbox("alpha", recipient, { workingDirectory: dir });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.body, "ALL HANDS");
  }
  // Sender does NOT receive their own broadcast.
  assert.equal(
    listMailbox("alpha", "worker-1", { workingDirectory: dir }).length,
    0,
  );
});

test("markNotified + markDelivered update timestamps and listMailbox honors includeDelivered", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sent = sendMessage(
    {
      team_name: "alpha",
      from_worker: "worker-1",
      to_worker: "worker-2",
      body: "hello",
    },
    { workingDirectory: dir },
  );
  assert.equal(sent.notified_at, undefined);
  assert.equal(sent.delivered_at, undefined);

  const notified = markNotified("alpha", "worker-2", sent.message_id, {
    workingDirectory: dir,
  });
  assert.equal(typeof notified.notified_at, "string");
  assert.equal(notified.delivered_at, undefined);

  // Default listMailbox includes not-yet-delivered messages.
  const beforeDelivery = listMailbox("alpha", "worker-2", {
    workingDirectory: dir,
  });
  assert.equal(beforeDelivery.length, 1);

  const delivered = markDelivered("alpha", "worker-2", sent.message_id, {
    workingDirectory: dir,
  });
  assert.equal(typeof delivered.delivered_at, "string");
  // notified_at must NOT be overwritten on delivery.
  assert.equal(delivered.notified_at, notified.notified_at);

  // Default listMailbox excludes delivered messages.
  const afterDeliveryDefault = listMailbox("alpha", "worker-2", {
    workingDirectory: dir,
  });
  assert.equal(afterDeliveryDefault.length, 0);

  // includeDelivered=true brings them back.
  const afterDeliveryAll = listMailbox("alpha", "worker-2", {
    workingDirectory: dir,
    includeDelivered: true,
  });
  assert.equal(afterDeliveryAll.length, 1);
  assert.equal(afterDeliveryAll[0]?.message_id, sent.message_id);
});

test("markDelivered on missing message throws MESSAGE_NOT_FOUND", (t) => {
  const dir = freshDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  assert.throws(
    () =>
      markDelivered("alpha", "worker-2", "no-such-id", {
        workingDirectory: dir,
      }),
    /MESSAGE_NOT_FOUND/,
  );
});
