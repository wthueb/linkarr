const title = process.env.PR_TITLE ?? "";
if (
  !/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/.test(title)
) {
  console.error("Use a Conventional Commit PR title, for example: feat: add a new site adapter");
  process.exitCode = 1;
}
