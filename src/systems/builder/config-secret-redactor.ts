// Strips credentials out of a server config before it is sent to a third-party
// AI, and puts them back afterwards.
//
// This is the single most important guard in the /config feature. Minecraft
// server configs routinely carry `mysql.password`, RCON passwords, webhook URLs
// and licence keys. Uploading one verbatim would hand those to an external
// provider — a real leak the uploader never agreed to, caused by a feature that
// looks like it only edits text.
//
// The approach is placeholder substitution, not deletion: the AI sees a stable
// token in place of each secret, and the original value is restored in the
// result. That keeps the returned file usable while the secret never leaves the
// process.

// Keys whose VALUE is treated as a secret. Tested as a substring of the whole key,
// not just its last segment, so `password:`, `mysql.password:` and `db-pass:` all
// match. Deliberately broad: a false positive costs nothing (the value is restored
// afterwards anyway), a false negative leaks a credential to a third party.
const SECRET_KEY_PATTERN =
    /(pass|passwd|password|token|secret|api[-_]?key|apikey|access[-_]?key|private[-_]?key|rcon|licen[cs]e|credential|auth|dsn|webhook)/i;

// A placeholder shape that survives a round trip through an LLM: no spaces, no
// characters YAML/JSON would need to quote, and distinctive enough that a model
// treats it as an opaque value to copy rather than text to rewrite.
const PLACEHOLDER_PREFIX = '__STELLA_SECRET_';
const PLACEHOLDER_SUFFIX = '__';

function placeholderFor(index: number): string {
    return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
}

export interface RedactionResult {
    redacted: string;
    // placeholder -> original value. Never logged, never persisted.
    secrets: Map<string, string>;
}

// Values that are not worth protecting and are clearer left visible: empty
// strings, obvious placeholders, and booleans (`auth: true` is a setting, not a
// credential — redacting it would make the AI unable to reason about it).
function isWorthRedacting(value: string): boolean {
    const v = value.trim().replace(/^["']|["']$/g, '').trim();
    if (!v) return false;
    if (v.length < 3) return false;
    if (/^(true|false|null|none|yes|no|on|off|\d+)$/i.test(v)) return false;
    if (/^(changeme|password|your[-_]?password|xxx+|\*+|<.*>)$/i.test(v)) return false;
    return true;
}

// Replace secret values with placeholders, line by line. Line-based on purpose:
// this must work on YAML, .properties and .conf without a parser for each, and
// without reformatting a single line it does not touch.
export function redactSecrets(text: string): RedactionResult {
    const secrets = new Map<string, string>();
    let index = 0;

    const lines = text.split(/\r?\n/).map(line => {
        // Skip comments: a commented-out example password is not a live secret,
        // and rewriting comments would churn the diff for no reason.
        if (/^\s*[#;]/.test(line)) return line;

        // `key: value` (YAML) or `key=value` (.properties / .conf). The key part
        // deliberately allows dots and dashes so nested YAML keys match.
        const match = line.match(/^(\s*['"]?[\w.\-]+['"]?\s*[:=]\s*)(.+?)(\s*)$/);
        if (!match) return line;

        const [, head, rawValue, trail] = match;
        const keyName = head.replace(/['"\s:=]/g, '');
        if (!SECRET_KEY_PATTERN.test(keyName)) return line;
        if (!isWorthRedacting(rawValue)) return line;

        // Preserve surrounding quotes so the file stays syntactically identical:
        // only the inner value is swapped.
        const quoted = rawValue.match(/^(['"])([\s\S]*)\1$/);
        const inner = quoted ? quoted[2] : rawValue;
        const quote = quoted ? quoted[1] : '';

        const token = placeholderFor(index++);
        secrets.set(token, inner);
        return `${head}${quote}${token}${quote}${trail}`;
    });

    return { redacted: lines.join('\n'), secrets };
}

export interface RestoreResult {
    text: string;
    // Placeholders the AI failed to echo back. Each one is a secret that would be
    // MISSING from the returned file, so the caller must warn rather than hand
    // over a config that silently lost its database password.
    lost: number;
}

// Put the original values back. Every placeholder is replaced globally, because a
// model may legitimately move a line or duplicate a value across sections.
export function restoreSecrets(text: string, secrets: Map<string, string>): RestoreResult {
    let out = text;
    let lost = 0;

    for (const [token, value] of secrets) {
        if (!out.includes(token)) {
            lost++;
            continue;
        }
        out = out.split(token).join(value);
    }

    return { text: out, lost };
}

// Belt-and-braces check before anything is returned to Discord: if a stray
// placeholder survived (one we have no value for), the file is inconsistent and
// must not be presented as a working config.
export function hasUnresolvedPlaceholder(text: string): boolean {
    return new RegExp(`${PLACEHOLDER_PREFIX}\\d+${PLACEHOLDER_SUFFIX}`).test(text);
}
