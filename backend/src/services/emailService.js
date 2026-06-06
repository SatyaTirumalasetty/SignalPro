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

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
