import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
    // Optional: only needed by `npm run db:check-drift`, which replays the
    // migrations into a throwaway schema to compare them with schema.prisma.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
