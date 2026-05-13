/**
 * Root ESLint config for the orbit.ctrl monorepo.
 *
 * - TypeScript-aware via @typescript-eslint
 * - SonarJS plugin: cognitive-complexity metric + code-smell rules (no server needed)
 * - Prettier handles formatting (eslint-config-prettier disables conflicting rules)
 * - `no-console` enforced project-wide; `warn`/`error` allowed for genuine problems
 *   (see CLAUDE.md § Logging)
 *
 * Cognitive complexity threshold is 15 — SonarSource's calibrated default.
 * If a function trips this, refactor it rather than bumping the threshold.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'sonarjs'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:sonarjs/recommended-legacy',
    'prettier',
  ],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': 'warn',

    // Cognitive complexity — the main SonarQube metric. Calibrated default is 15.
    // See https://www.sonarsource.com/resources/cognitive-complexity/
    'sonarjs/cognitive-complexity': ['error', 15],
  },
  ignorePatterns: ['dist', 'build', 'node_modules', 'coverage', '*.cjs'],
};
