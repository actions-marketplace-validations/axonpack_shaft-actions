import { defineConfig } from 'oxlint';
import node from 'oxlint-config-universe/node';

export default defineConfig({
  extends: [node],
  rules: {
    // The code uses one-line guard clauses (`if (!x) return;`) throughout; braces would change style, not behaviour.
    curly: 'off',
  },
});
