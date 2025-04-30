import dns from 'dns';
import nodemailer from 'nodemailer';
import util from 'util';

const dnsResolveMx = util.promisify(dns.resolveMx);

// attempt to verify a single address via SMTP RCPT-TO
export async function verifyEmail(email, domain) {
  const start = Date.now();
  let mx;
  try {
    mx = await dnsResolveMx(domain);
    if (!mx.length) return false;
  } catch {
    return false;
  }
  // pick highest-priority MX
  mx.sort((a,b)=>a.priority-b.priority);
  const mxHost = mx[0].exchange;

  // connect to port 25 on that host
  const transporter = nodemailer.createTransport({
    host: mxHost,
    port: 25,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });

  try {
    await transporter.verify();               // establish handshake
    const info = await transporter.checkRecipient(email);
    return info === true || info === undefined;
  } catch (err) {
    return false;
  }
}

// test catch-all by verifying a random nonexistent address
export async function testForCatchall(domain) {
  const randomStr = Math.random().toString(36).substr(2,8);
  const fake = `noone-${randomStr}@${domain}`;
  const ok = await verifyEmail(fake, domain);
  return ok;
}
