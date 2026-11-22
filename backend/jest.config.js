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
};
