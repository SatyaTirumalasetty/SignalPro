const { helmetOptions } = require('../../config/security');

describe('Helmet security config', () => {
  test('locks down CSP to deny-all for the JSON-only API', () => {
    expect(helmetOptions.contentSecurityPolicy.directives.defaultSrc).toEqual(["'none'"]);
    expect(helmetOptions.contentSecurityPolicy.directives.frameAncestors).toEqual(["'none'"]);
  });

  test('enables HSTS with a 1-year max age including subdomains', () => {
    expect(helmetOptions.hsts).toEqual({ maxAge: 31536000, includeSubDomains: true });
  });
});
