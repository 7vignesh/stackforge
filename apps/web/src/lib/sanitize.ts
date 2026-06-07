/**
 * Sanitize a string for safe rendering in the DOM.
 *
 * While React auto-escapes JSX text content, this provides defense-in-depth
 * for cases where stream buffer content might be used in contexts like
 * `dangerouslySetInnerHTML`, `title` attributes, or passed to third-party
 * components that don't escape properly.
 *
 * Strips:
 * - HTML script tags and event handlers
 * - javascript: protocol URLs
 * - Null bytes
 */

const SCRIPT_TAG_REGEX = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const EVENT_HANDLER_REGEX = /\bon\w+\s*=\s*["'][^"']*["']/gi;
const JAVASCRIPT_PROTO_REGEX = /javascript\s*:/gi;
const NULL_BYTE_REGEX = /\0/g;

export function sanitizeStreamContent(content: string): string {
  return content
    .replace(NULL_BYTE_REGEX, "")
    .replace(SCRIPT_TAG_REGEX, "")
    .replace(EVENT_HANDLER_REGEX, "")
    .replace(JAVASCRIPT_PROTO_REGEX, "");
}

/**
 * Sanitize an SSE event payload to ensure no injected content can cause harm.
 * This validates that the parsed JSON doesn't contain executable payloads
 * in string fields.
 */
export function sanitizeEventData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeStreamContent(value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeEventData(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
