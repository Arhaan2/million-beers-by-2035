declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: D1Migration[];
    TEST_INITIAL_MIGRATION: D1Migration[];
    TEST_GROUP_MIGRATION: D1Migration[];
    TEST_CREW_MIGRATION: D1Migration[];
    MIGRATION_DB: D1Database;
    CREW_MIGRATION_DB: D1Database;
    FAILED_CREW_MIGRATION_DB: D1Database;
  }
}
