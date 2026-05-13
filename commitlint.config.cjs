/**
 * Conventional Commits enforcement for orbit.ctrl.
 *
 * Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
 * Subject must not be empty, sentence-cased, and under 80 chars.
 *
 * @example
 * ```
 * feat(api): add /satellites endpoint
 * fix(web): reconnect WebSocket on dropped frames
 * chore(deps): bump satellite.js to 5.0.1
 * ```
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 80],
    'subject-case': [0],
  },
};
