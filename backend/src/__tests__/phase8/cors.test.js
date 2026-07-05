describe('buildCorsOrigin', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });

  function allow(origin) {
    const { buildCorsOrigin } = require('../../config/security');
    let result;
    buildCorsOrigin()(origin, (err, ok) => { result = ok; });
    return result;
  }

  test('defaults to localhost dev origin', () => {
    delete process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URLS;
    expect(allow('http://localhost:5173')).toBe(true);
    expect(allow('https://evil.example.com')).toBe(false);
  });

  test('allows every origin listed in FRONTEND_URLS', () => {
    process.env.FRONTEND_URLS = 'https://bearbull.app, https://www.bearbull.app';
    expect(allow('https://bearbull.app')).toBe(true);
    expect(allow('https://www.bearbull.app')).toBe(true);
    expect(allow('https://bearbull.app.evil.com')).toBe(false);
  });

  test('vercel previews only when explicitly enabled', () => {
    expect(allow('https://signalpro-abc123-satya.vercel.app')).toBe(false);
    process.env.CORS_ALLOW_VERCEL_PREVIEWS = 'true';
    expect(allow('https://signalpro-abc123-satya.vercel.app')).toBe(true);
    expect(allow('https://fake.vercel.app.evil.com')).toBe(false);
  });

  test('requests with no Origin header (curl, health checks) pass', () => {
    expect(allow(undefined)).toBe(true);
  });
});
