interface Env {
  BEER_ADMIN_PIN: string;
  SESSION_SIGNING_SECRET: string;
  RATE_LIMIT_SALT: string;
}

declare namespace Cloudflare {
  interface Env {
    BEER_ADMIN_PIN: string;
    SESSION_SIGNING_SECRET: string;
    RATE_LIMIT_SALT: string;
  }
}

interface D1Migration {
  name: string;
  queries: string[];
}
