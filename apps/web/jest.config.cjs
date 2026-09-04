/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Native ESM mode — this package is "type": "module". Run via
  // `node --experimental-vm-modules`.
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  moduleNameMapper: {
    // Resolve workspace packages directly from source (no build step needed)
    '^@orbit-ctrl/types$': '<rootDir>/../../packages/types/src/index.ts',
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
