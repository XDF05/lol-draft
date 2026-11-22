require('dotenv/config');
// Point every test at the isolated test database (localhost:5432) so the
// development `league_draft` database is never touched by the test suite.
process.env.DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/league_draft_test?schema=draft_db';
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
}
