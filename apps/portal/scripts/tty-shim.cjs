/**
 * TTY shim for drizzle-kit push in CI (non-interactive environments).
 *
 * drizzle-kit v0.31.10 checks process.stdin.isTTY and process.stdout.isTTY
 * before showing the interactive confirmation prompt. In CI, there is no TTY,
 * so we patch isTTY to return true to satisfy the check, then provide
 * an automatic "y" confirmation via stdin pipe.
 */
if (!process.stdin.isTTY) {
  Object.defineProperty(process.stdin, 'isTTY', { value: true });
}
if (!process.stdout.isTTY) {
  Object.defineProperty(process.stdout, 'isTTY', { value: true });
}
