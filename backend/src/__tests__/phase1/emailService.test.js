const mockSendMail = jest.fn().mockResolvedValue(undefined);
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({ createTransport: mockCreateTransport }));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  mockSendMail.mockClear();
  mockCreateTransport.mockClear();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('emailService without SMTP configured', () => {
  test('sendEmail-backed helpers log instead of sending', async () => {
    delete process.env.SMTP_PASSWORD;
    const { sendVerificationEmail } = require('../../services/emailService');

    await sendVerificationEmail('user@example.com', 'token123');

    expect(mockCreateTransport).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('emailService with SMTP configured', () => {
  beforeEach(() => {
    process.env.SMTP_PASSWORD = 'secret';
    process.env.FRONTEND_URL = 'https://app.signalpro.test';
  });

  test('sendVerificationEmail sends a verification link', async () => {
    const { sendVerificationEmail } = require('../../services/emailService');

    await sendVerificationEmail('user@example.com', 'token123');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('Verify'),
      html: expect.stringContaining('https://app.signalpro.test/verify-email?token=token123'),
    }));
  });

  test('sendPasswordResetEmail sends a reset link', async () => {
    const { sendPasswordResetEmail } = require('../../services/emailService');

    await sendPasswordResetEmail('user@example.com', 'token456');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('Reset'),
      html: expect.stringContaining('https://app.signalpro.test/reset-password?token=token456'),
    }));
  });

  test('sendAutoTradingOrderEmail describes the executed trade', async () => {
    const { sendAutoTradingOrderEmail } = require('../../services/emailService');

    await sendAutoTradingOrderEmail('user@example.com', { symbol: 'AAPL', side: 'buy', quantity: 10, price: 150 });

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('AAPL'),
      html: expect.stringContaining('10 AAPL'),
    }));
  });

  test('sendAutoTradingDailyLossLimitEmail explains the pause', async () => {
    const { sendAutoTradingDailyLossLimitEmail } = require('../../services/emailService');

    await sendAutoTradingDailyLossLimitEmail('user@example.com');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('daily loss limit'),
      html: expect.stringContaining('Auto Trading'),
    }));
  });

  test('sendAutoTradingDisabledEmail explains the circuit breaker', async () => {
    const { sendAutoTradingDisabledEmail } = require('../../services/emailService');

    await sendAutoTradingDisabledEmail('user@example.com');

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('disabled'),
      html: expect.stringContaining('Auto Trading settings'),
    }));
  });
});
