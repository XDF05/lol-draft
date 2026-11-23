module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/e2e/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: './tests/e2e/tsconfig.json', isolatedModules: true },
    ],
  },
  testTimeout: 240000,
  maxWorkers: 1,
};
