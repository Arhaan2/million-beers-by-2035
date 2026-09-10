import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// This binding is isolated Workers test storage. Production migrations leave
// new mutation capabilities disabled until the operator verifies readiness.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM allocation_corrections'),
    env.DB.prepare('DELETE FROM entry_corrections'),
    env.DB.prepare('DELETE FROM entry_metadata'),
    env.DB.prepare('DELETE FROM entry_classification'),
    env.DB.prepare('DELETE FROM projection_audit'),
    env.DB.prepare('DELETE FROM allocation_members'),
    env.DB.prepare('DELETE FROM member_activity'),
    env.DB.prepare('DELETE FROM member_aliases'),
    env.DB.prepare('DELETE FROM contributor_activity'),
    env.DB.prepare('DELETE FROM crew_members'),
    env.DB.prepare('UPDATE upgrade_state SET mutations_enabled = 1, revision = 0 WHERE id = 1'),
  ]);
});
