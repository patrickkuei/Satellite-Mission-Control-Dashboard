/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Native ESM mode — required because satellite.js v7 ships pure ESM with no
  // CommonJS fallback. Run via `node --experimental-vm-modules`.
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    // Resolve workspace packages directly from source (no build step needed)
    '^@orbit-ctrl/types$': '<rootDir>/../../packages/types/src/index.ts',
    '^@orbit-ctrl/tools$': '<rootDir>/../../packages/tools/src/index.ts',
    // Strip .js extension from relative imports — ts-jest resolves .ts instead
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: { module: 'ESNext', moduleResolution: 'Bundler' },
      },
    ],
  },
};
