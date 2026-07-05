jest.mock('axios', () => ({ create: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })) }));
const axios = require('axios');
const AlpacaAdapter = require('../../services/brokers/adapters/alpaca');

describe('ALPACA_FORCE_PAPER', () => {
  const saved = process.env.ALPACA_FORCE_PAPER;
  afterEach(() => {
    process.env.ALPACA_FORCE_PAPER = saved;
    if (saved === undefined) delete process.env.ALPACA_FORCE_PAPER;
    jest.clearAllMocks();
  });

  test('live credentials are forced onto the paper API when flag is true', () => {
    process.env.ALPACA_FORCE_PAPER = 'true';
    const adapter = new AlpacaAdapter({ api_key: 'k', api_secret: 's', paper: false });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://paper-api.alpaca.markets' })
    );
    expect(adapter.credentials.paper).toBe(true);
  });

  test('live credentials reach the live API when flag is unset', () => {
    delete process.env.ALPACA_FORCE_PAPER;
    new AlpacaAdapter({ api_key: 'k', api_secret: 's', paper: false });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.alpaca.markets' })
    );
  });
});
