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

module.exports = { helmetOptions };
