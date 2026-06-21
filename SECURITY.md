# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in StackForge, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainers directly or use GitHub's private vulnerability reporting feature.
3. Include a clear description, steps to reproduce, and potential impact.

We aim to acknowledge reports within 48 hours and provide a fix within 7 days for critical issues.

## Security Measures

This project implements the following security controls:

### Authentication & Authorization
- API key authentication via `STACKFORGE_API_KEY` environment variable
- When set, all endpoints (except `/api/runtime` and `/healthz`) require a valid key
- Keys can be passed via `Authorization: Bearer <key>` or `X-API-Key: <key>` headers
- Constant-time comparison to prevent timing attacks

### Transport Security
- HSTS headers enforced in production (1 year, includeSubDomains, preload)
- Automatic HTTP→HTTPS redirect in production
- `trust proxy` configured for reverse proxy deployments

### Input Validation
- All request bodies validated with Zod schemas
- Request body size limits: 2MB global, 64KB for generation endpoints
- GitHub token format validation (must match known PAT prefixes)
- Repository name validation against GitHub naming rules
- File path traversal protection for GitHub push operations
- Prototype pollution protection on user-supplied JSON

### Rate Limiting
- General: 100 requests per 15 minutes per IP
- Generation endpoints: 10 requests per 15 minutes per IP
- GitHub push: 5 requests per 15 minutes per IP

### CORS
- Origins restricted to configured allowlist (`CORS_ALLOWED_ORIGINS` env var)
- No wildcard `*` origins

### Security Headers (via Helmet)
- Content-Security-Policy
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Strict-Transport-Security
- X-XSS-Protection
- Referrer-Policy

### Content Security Policy (Frontend)
- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
- `font-src 'self' https://fonts.gstatic.com`
- `connect-src 'self'`
- `frame-ancestors 'none'`

### Resource Protection
- In-memory job store: max 200 entries, 1-hour TTL for completed jobs
- Telemetry store: max 200 entries, 1-hour TTL
- Agent cache: max 500 entries, 30-minute TTL
- SSE connections: max 20 per job, 200 total, 30-minute timeout
- ZIP generation: max 500 files, 10MB output limit

### Error Handling
- Production errors are sanitized — no stack traces or internal details exposed
- Known safe error patterns are allowlisted for client exposure
- All errors logged with request ID for correlation

### Observability
- Unique `X-Request-Id` assigned to every request
- Request IDs propagated to error logs for tracing
- GitHub tokens redacted in all log output

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `STACKFORGE_API_KEY` | API authentication key | No (auth disabled if empty) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins | No (defaults to localhost) |
| `NODE_ENV` | Environment mode (`production` enables stricter security) | Recommended |
| `OPENROUTER_API_KEY_*` | LLM provider keys | Yes (for non-mock mode) |
| `NVIDIA_API_KEY_*` | Codegen provider keys | Optional |

## Best Practices for Deployment

1. **Always set `NODE_ENV=production`** in production deployments
2. **Set `STACKFORGE_API_KEY`** to a strong random value
3. **Configure `CORS_ALLOWED_ORIGINS`** to your actual frontend domain
4. **Use HTTPS** — deploy behind a reverse proxy (nginx, Cloudflare, etc.)
5. **Rotate API keys** regularly, especially if they may have been exposed
6. **Never commit `.env` files** — use secrets management (Vault, AWS SSM, etc.)
7. **Monitor rate limit headers** (`RateLimit-*`) for abuse detection
