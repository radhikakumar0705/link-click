/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'base62',
      testMatch: ['<rootDir>/shared/base62/src/__tests__/**/*.test.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'shared/base62/tsconfig.json' }] },
    },
    {
      displayName: 'validation',
      testMatch: ['<rootDir>/shared/validation/src/__tests__/**/*.test.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'shared/validation/tsconfig.json' }] },
    },
    {
      displayName: 'write-service',
      testMatch: ['<rootDir>/services/write-service/src/__tests__/**/*.test.ts'],
      transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'services/write-service/tsconfig.json' }] },
      moduleNameMapper: {
        '^@link-click/base62$': '<rootDir>/shared/base62/src/index.ts',
        '^@link-click/types$': '<rootDir>/shared/types/src/index.ts',
        '^@link-click/validation$': '<rootDir>/shared/validation/src/index.ts',
      },
    },
  ],
  collectCoverageFrom: [
    'shared/*/src/**/*.ts',
    'services/*/src/**/*.ts',
    '!**/__tests__/**',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageThresholds: {
    global: {
      branches: 70,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
};
