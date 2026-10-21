import { configDefaults, defineConfig } from "vitest/config";

// Worktrees under .claude/ hold their own copies of every test file; without this, a path
// filter like `npm run compare` matches and runs all of them.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
