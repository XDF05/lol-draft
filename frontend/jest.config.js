module.exports = {
  rootDir: '.',
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: './tsconfig.json',
        isolatedModules: true,
        diagnostics: false,
        compilerOptions: {
          module: 'commonjs',
          jsx: 'react-jsx',
          target: 'ES2017',
          moduleResolution: 'node',
        },
      },
    ],
  },
  setupFilesAfterEnv: ['./tests/setup.ts'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testTimeout: 30000,
};
