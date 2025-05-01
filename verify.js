import dns from 'dns';
import nodemailer from 'nodemailer';
import util from 'util';

const dnsResolveMx = util.promisify(dns.resolveMx);

export interface VerificationResult {
  ok: boolean;            // true only if recipient accepted
  rejected: boolean;      // true only if recipient explicitly rejected
  reason: 'no_mx' | 'dns_error' | 'handshake_error' | 'recipient_rejected' | 'check_error' | 'accepted';
  error?: string;         // raw error message for dns/handshake/check errors
  latencyMs: number;      // round-trip time
}

/**
 * Attempt to verify a single address via SMTP RCPT-TO.
 * Logs each stage: MX lookup, chosen MX, handshake, RCPT-TO check.
 */
export async function verifyEmail(email: string, domain: string): Promise<VerificationResult> {
  const start = Date.now();
  console.log(`[verifyEmail] START → verifying "${email}@${domain}"`);

  // 1) MX lookup
  let mxRecords;
  try {
    mxRecords = await dnsResolveMx(domain);
    console.log(`[verifyEmail] MX records for ${domain}:`, mxRecords);
    if (!mxRecords || mxRecords.length === 0) {
      const latency = Date.now() - start;
      console.log(`[verifyEmail] no MX records found (latency ${latency}ms)`);
      return { ok:false, rejected:false, reason:'no_mx', latencyMs: latency };
    }
  } catch (err: any) {
    const latency = Date.now() - start;
    console.log(`[verifyEmail] DNS lookup error for ${domain}:`, err);
    return {
      ok: false,
      rejected: false,
      reason: 'dns_error',
      error: err.message,
      latencyMs: latency
    };
  }

  // 2) pick highest-priority MX
  mxRecords.sort((a, b) => a.priority - b.priority);
  const mxHost = mxRecords[0].exchange;
  console.log(`[verifyEmail] selected MX host: ${mxHost}`);

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
    console.log(`[verifyEmail] initiating SMTP handshake with ${mxHost}`);
    await transporter.verify();
    console.log(`[verifyEmail] handshake succeeded`);
  } catch (err: any) {
    const latency = Date.now() - start;
    console.log(`[verifyEmail] handshake error:`, err);
    return {
      ok: false,
      rejected: false,
      reason: 'handshake_error',
      error: err.message,
      latencyMs: latency
    };
  }

  // 4) RCPT-TO check
  try {
    console.log(`[verifyEmail] RFC5321 RCPT-TO check for "${email}@${domain}"`);
    const info = await transporter.checkRecipient(email);
    const latency = Date.now() - start;
    console.log(`[verifyEmail] checkRecipient response:`, info);

    if (info === false) {
      console.log(`[verifyEmail] recipient explicitly rejected`);
      return {
        ok: false,
        rejected: true,
        reason: 'recipient_rejected',
        latencyMs: latency
      };
    }

    console.log(`[verifyEmail] recipient accepted`);
    return {
      ok: true,
      rejected: false,
      reason: 'accepted',
      latencyMs: latency
    };
  } catch (err: any) {
    const latency = Date.now() - start;
    console.log(`[verifyEmail] checkRecipient error (grey-list/timeout):`, err);
    return {
      ok: false,
      rejected: false,
      reason: 'check_error',
      error: err.message,
      latencyMs: latency
    };
  }
}

/**
 * Test for catch-all by verifying a random nonexistent address.
 * Logs the fake address and the result.
 */
export async function testForCatchall(domain: string): Promise<boolean> {
  const randomStr = Math.random().toString(36).substr(2,8);
  const fake = `noone-${randomStr}@${domain}`;
  console.log(`[testForCatchall] testing fake address: ${fake}`);
  const result = await verifyEmail(randomStr, domain);
  console.log(`[testForCatchall] result for ${fake}:`, result);
  return result.ok === true;
}
