module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: './tsconfig.json' }],
  },
  setupFiles: ['./tests/setup.js'],
  testTimeout: 30000,
  // Integration tests share a real PostgreSQL and Redis database, so they
  // must run serially to avoid rate-limit counter interference between files.
  maxWorkers: 1,
};
