const nodemailer = require('nodemailer');
const logger = require('../config/logger');

const APP_NAME = 'SignalPro';
const FROM = process.env.FROM_EMAIL || 'noreply@signalpro.com';
const BASE_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function createTransporter() {
  if (!process.env.SMTP_PASSWORD) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'apikey',
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

async function sendEmail(to, subject, html) {
  const transporter = createTransporter();
  if (!transporter) {
    logger.info({ to, subject }, '[DEV] Email not sent — SMTP_PASSWORD not configured');
    return;
  }
  await transporter.sendMail({ from: FROM, to, subject, html });
}

async function sendVerificationEmail(email, token) {
  const url = `${BASE_URL}/verify-email?token=${token}`;
  await sendEmail(
    email,
    `Verify your ${APP_NAME} account`,
    `<p>Thanks for signing up! Click the link below to verify your email. It expires in 24 hours.</p>
     <p><a href="${url}">${url}</a></p>
     <p>If you didn't create an account, ignore this email.</p>`
  );
}

async function sendPasswordResetEmail(email, token) {
  const url = `${BASE_URL}/reset-password?token=${token}`;
  await sendEmail(
    email,
    `Reset your ${APP_NAME} password`,
    `<p>We received a request to reset your password. Click the link below — it expires in 1 hour.</p>
     <p><a href="${url}">${url}</a></p>
     <p>If you didn't request this, ignore this email. Your password won't change.</p>`
  );
}

async function sendAutoTradingOrderEmail(email, { symbol, side, quantity, price }) {
  await sendEmail(
    email,
    `${APP_NAME}: Auto-trade executed — ${side.toUpperCase()} ${symbol}`,
    `<p>Your auto-trading engine placed a <strong>${side}</strong> order for <strong>${quantity} ${symbol}</strong> at ~${price}.</p>
     <p>View the details in your <a href="${BASE_URL}/auto-trading">Auto Trading activity log</a>.</p>`
  );
}

async function sendAutoTradingDailyLossLimitEmail(email) {
  await sendEmail(
    email,
    `${APP_NAME}: Auto-trading paused — daily loss limit reached`,
    `<p>Your auto-trading engine has paused new trades for today after reaching your configured daily loss limit.</p>
     <p>Trading will resume automatically tomorrow. Review your settings in <a href="${BASE_URL}/auto-trading">Auto Trading</a>.</p>`
  );
}

async function sendAutoTradingDisabledEmail(email) {
  await sendEmail(
    email,
    `${APP_NAME}: Auto-trading disabled after repeated errors`,
    `<p>Your auto-trading engine encountered repeated errors and has been automatically disabled to protect your account.</p>
     <p>Check the activity log and re-enable it from <a href="${BASE_URL}/auto-trading">Auto Trading settings</a> once the issue is resolved.</p>`
  );
}

async function sendAutoTradingActionEmail(email, { symbol, action, detail }) {
  const label = String(action).replace(/_/g, ' ');
  await sendEmail(
    email,
    `SignalPro auto-trading: ${label} — ${symbol}`,
    `<p>The autonomous engine executed <strong>${label}</strong> on <strong>${symbol}</strong>.</p>
     <p>${detail || ''}</p>
     <p>Review the activity feed on the Auto Trading page for full reasoning.</p>`
  );
}

async function sendAutoTradingNeedsAttentionEmail(email, { symbol, message }) {
  await sendEmail(
    email,
    `SignalPro auto-trading NEEDS ATTENTION — ${symbol}`,
    `<p><strong>Manual review required for ${symbol}.</strong></p>
     <p>${message}</p>
     <p>Check your broker account directly — the engine may have left the position without protective orders.</p>`
  );
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAutoTradingOrderEmail,
  sendAutoTradingDailyLossLimitEmail,
  sendAutoTradingDisabledEmail,
  sendAutoTradingActionEmail,
  sendAutoTradingNeedsAttentionEmail,
};
