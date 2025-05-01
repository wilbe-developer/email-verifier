import dns from 'dns';
import nodemailer from 'nodemailer';
import util from 'util';

const dnsResolveMx = util.promisify(dns.resolveMx);

export interface VerificationResult {
  ok: boolean;            // true only if recipient accepted
  rejected: boolean;      // true only if recipient explicitly rejected
  reason: string;         // one of: 'no_mx','dns_error','handshake_error','recipient_rejected','check_error'
  error?: string;         // raw error message for dns/handshake/check errors
  latencyMs: number;      // round-trip time
}

// attempt to verify a single address via SMTP RCPT-TO
export async function verifyEmail(email: string, domain: string): Promise<VerificationResult> {
  const start = Date.now();

  // 1) MX lookup
  let mxRecords;
  try {
    mxRecords = await dnsResolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      return { 
        ok: false, 
        rejected: false, 
        reason: 'no_mx', 
        latencyMs: Date.now() - start 
      };
    }
  } catch (err: any) {
    return {
      ok: false,
      rejected: false,
      reason: 'dns_error',
      error: err.message,
      latencyMs: Date.now() - start
    };
  }

  // 2) pick highest priority MX
  mxRecords.sort((a, b) => a.priority - b.priority);
  const mxHost = mxRecords[0].exchange;

  // 3) SMTP handshake
  const transporter = nodemailer.createTransport({
    host: mxHost,
    port: 25,
    secure: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
  });

  try {
    await transporter.verify();
  } catch (err: any) {
    return {
      ok: false,
      rejected: false,
      reason: 'handshake_error',
      error: err.message,
      latencyMs: Date.now() - start
    };
  }

  // 4) RCPT-TO check
  try {
    const info = await transporter.checkRecipient(email);
    if (info === false) {
      // server explicitly said “no such user”
      return {
        ok: false,
        rejected: true,
        reason: 'recipient_rejected',
        latencyMs: Date.now() - start
      };
    }
    // info === true || undefined → accepted
    return {
      ok: true,
      rejected: false,
      reason: 'accepted',
      latencyMs: Date.now() - start
    };
  } catch (err: any) {
    // grey-list, timeout, or other transient error
    return {
      ok: false,
      rejected: false,
      reason: 'check_error',
      error: err.message,
      latencyMs: Date.now() - start
    };
  }
}

// test catch-all by verifying a random nonexistent address
export async function testForCatchall(domain: string): Promise<boolean> {
  const randomStr = Math.random().toString(36).substr(2, 8);
  const fake = `noone-${randomStr}@${domain}`;
  const result = await verifyEmail(fake, domain);
  // if *accepted* by RCPT-TO (ok===true), it’s a catch-all
  return result.ok === true;
}
