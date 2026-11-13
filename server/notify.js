// Notification channels. Each sender throws on failure so the scheduler can log it.
// Credentials come only from environment variables (.env) — see .env.example.
import { execFile } from 'node:child_process';
import nodemailer from 'nodemailer';

const env = process.env;

export const emailConfigured = () => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
export const whatsappConfigured = () =>
  env.WHATSAPP_PROVIDER === 'meta' ? !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_TO)
    : env.WHATSAPP_PROVIDER === 'twilio' ? !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM && env.WHATSAPP_TO)
      : false;

// ---- email (SMTP via nodemailer) ----
let transport;
export async function sendEmail(subject, textBody, htmlBody) {
  if (!emailConfigured()) throw new Error('Email is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS in .env)');
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 15000,
  });
  await transport.sendMail({ from: env.EMAIL_FROM || env.SMTP_USER, to: env.EMAIL_TO || env.SMTP_USER, subject, text: textBody, html: htmlBody });
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const emailHtml = (title, body, url) => `
<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1f">
  <h2 style="margin:0 0 12px;font-size:18px">${escHtml(title)}</h2>
  <p style="margin:0 0 20px;white-space:pre-line;line-height:1.5;color:#44444d">${escHtml(body)}</p>
  <a href="${escHtml(url)}" style="display:inline-block;padding:10px 16px;background:#5b5bd6;color:#fff;border-radius:8px;text-decoration:none">Open dashboard</a>
  <p style="margin:24px 0 0;font-size:12px;color:#8b8b96">Sent by your local Productivity Command Center.</p>
</div>`;

// ---- WhatsApp (Meta Cloud API or Twilio, plain HTTPS) ----
export async function sendWhatsApp(body) {
  if (!whatsappConfigured()) throw new Error('WhatsApp is not configured (see .env.example)');
  let res;
  if (env.WHATSAPP_PROVIDER === 'meta') {
    res = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION || 'v21.0'}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: env.WHATSAPP_TO.replace(/\D/g, ''), type: 'text', text: { body } }),
      signal: AbortSignal.timeout(15000),
    });
  } else {
    const to = env.WHATSAPP_TO.startsWith('whatsapp:') ? env.WHATSAPP_TO : `whatsapp:${env.WHATSAPP_TO}`;
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: env.TWILIO_WHATSAPP_FROM, To: to, Body: body }),
      signal: AbortSignal.timeout(15000),
    });
  }
  if (!res.ok) throw new Error(`${env.WHATSAPP_PROVIDER} API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// ---- Windows desktop toast (native, via PowerShell + WinRT; no dependency) ----
const escXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const TOAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($env:TOAST_XML)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($toast)`;
const TOAST_B64 = Buffer.from(TOAST_SCRIPT, 'utf16le').toString('base64');

export function sendDesktop(title, body, url) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Desktop toasts are only implemented for Windows'));
  const xml = `<toast activationType="protocol" launch="${escXml(url)}"><visual><binding template="ToastGeneric"><text>${escXml(title)}</text><text>${escXml(body)}</text></binding></visual></toast>`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', TOAST_B64],
      { env: { ...process.env, TOAST_XML: xml }, windowsHide: true, timeout: 20000 },
      (err, _stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim().slice(0, 300))) : resolve()));
  });
}

// ---- browser (Server-Sent Events to open dashboard tabs) ----
const clients = new Set();

export function sseHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export const browserConnected = () => clients.size > 0;

export function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) c.write(msg);
  return clients.size;
}

export function sendBrowser(payload) {
  if (!clients.size) throw Object.assign(new Error('Dashboard is not open in a browser'), { skipped: true });
  broadcast('reminder', payload);
}

setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();
