const SAFE_UNQUOTED_SHELL_ARG = /^[a-zA-Z0-9._:/-]+$/;

const ALLOWED_AWS_CLI_SEGMENT =
  /^aws\s+(ec2|rds|ssm|elbv2|elb|resourcegroupstaggingapi|secretsmanager|cloudwatch|autoscaling)\s+[a-z0-9-]+(?:\s+|$)/i;

const FORBIDDEN_CLI_PATTERNS = [
  /[\x00-\x1f\x7f]/,
  /[;|`<>]/,
  /\$\(/,
  /\$\{/,
  /\bsend-command\b/i,
  /\bstart-session\b/i,
  /\bexecute-statement\b/i,
  /\bterminate-instances\b/i,
  /\bdelete-db-cluster\b/i,
  /\bterraform\s+destroy\b/i,
  /file:\/\//i,
];

export function stripControlChars(input: string): string {
  return input.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

/**
 * Escapes an argument for safe copy-paste into POSIX shells (bash/zsh/sh).
 * Single quotes neutralize `$()`, backticks, `\`, `"`, globbing, and spaces.
 */
export function shellQuote(raw: string): string {
  const cleaned = stripControlChars(raw);
  if (!cleaned) return "''";
  if (SAFE_UNQUOTED_SHELL_ARG.test(cleaned)) {
    return cleaned;
  }
  return `'${cleaned.replace(/'/g, `'\\''`)}'`;
}

/**
 * Escapes a string literal inside Terraform HCL double quotes, neutralizing
 * quotes, backslashes, and `${...}` / `%{...}` template interpolation.
 */
export function escapeHclString(raw: string): string {
  return stripControlChars(raw)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, () => "%%{");
}

/**
 * Validates that a CLI command returned by an LLM (or rule) contains only safe
 * AWS CLI invocations without shell injection metacharacters or privilege escalation.
 */
export function isSafeAwsCliCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > 600) return false;

  for (const pattern of FORBIDDEN_CLI_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Allow at most 2 chained AWS commands separated by ` && ` (e.g. snapshot && delete-volume),
  // while rejecting single `&` backgrounding or `||`.
  const segments = trimmed.split(/\s+&&\s+/);
  if (segments.length > 2) return false;

  for (const seg of segments) {
    if (seg.includes("&")) return false;
    if (!ALLOWED_AWS_CLI_SEGMENT.test(seg.trim())) return false;
  }

  return true;
}

export function isSafeTerraformSnippet(snippet: string): boolean {
  if (!snippet || snippet.length > 1500) return false;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(snippet)) return false;
  if (/\b(local-exec|remote-exec)\b/i.test(snippet)) return false;
  if (/data\s+"external"/i.test(snippet)) return false;
  if (/\bterraform\s+destroy\b/i.test(snippet)) return false;
  return true;
}
