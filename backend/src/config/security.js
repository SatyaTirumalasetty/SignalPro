// Helmet configuration for the JSON-only API: lock down CSP entirely since
// no HTML/scripts are served here.
const helmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
};

function buildCorsOrigin() {
  const explicit = new Set(
    [process.env.FRONTEND_URL || 'http://localhost:5173']
      .concat((process.env.FRONTEND_URLS || '').split(','))
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const allowVercelPreviews = process.env.CORS_ALLOW_VERCEL_PREVIEWS === 'true';
  const vercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (explicit.has(origin)) return callback(null, true);
    if (allowVercelPreviews && vercelPreview.test(origin)) return callback(null, true);
    return callback(null, false);
  };
}

module.exports = { helmetOptions, buildCorsOrigin };
