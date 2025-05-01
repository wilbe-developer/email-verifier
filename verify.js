import dns from 'dns';
import nodemailer from 'nodemailer';
import util from 'util';

const dnsResolveMx = util.promisify(dns.resolveMx);

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} ok            – true only if RCPT-TO was accepted
 * @property {boolean} rejected      – true only if RCPT-TO was explicitly rejected
 * @property {'no_mx'|'dns_error'|'handshake_error'|'recipient_rejected'|'check_error'|'accepted'} reason
 * @property {string=} error         – raw error message on DNS/handshake/check errors
 * @property {number} latencyMs      – round-trip time in ms
 */

/**
 * Attempt to verify a single address via SMTP RCPT-TO.
 * Logs each step and returns a VerificationResult.
 *
 * @param {string} localPart – the part before the @ (e.g. "j.l.cutler")
 * @param {string} domain    – the domain to verify against (e.g. "bham.ac.uk")
 * @returns {Promise<VerificationResult>}
 */
export async function verifyEmail(localPart, domain) {
  const start = Date.now();
  const full = `${localPart}@${domain}`;
  console.log(`[verifyEmail] START verifying "${full}"`);

  // 1) MX lookup
  let mxRecords;
  try {
    mxRecords = await dnsResolveMx(domain);
    console.log(`[verifyEmail] MX records for ${domain}:`, mxRecords);
    if (!Array.isArray(mxRecords) || mxRecords.length === 0) {
      const latency = Date.now() - start;
      console.log(`[verifyEmail] no MX found (latency ${latency}ms)`);
      return { ok: false, rejected: false, reason: 'no_mx', latencyMs: latency };
    }
  } catch (err) {
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
    console.log(`[verifyEmail] performing SMTP verify() handshake with ${mxHost}`);
    await transporter.verify();
    console.log(`[verifyEmail] handshake succeeded`);
  } catch (err) {
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
    console.log(`[verifyEmail] performing RCPT-TO for "${full}"`);
    const info = await transporter.checkRecipient(localPart);
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
  } catch (err) {
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
 *
 * @param {string} domain
 * @returns {Promise<boolean>} true if the fake address is accepted → catch-all
 */
export async function testForCatchall(domain) {
  const randomStr = Math.random().toString(36).slice(2, 10);
  const fakeLocal = `noone-${randomStr}`;
  console.log(`[testForCatchall] testing catch-all with ${fakeLocal}@${domain}`);
  const result = await verifyEmail(fakeLocal, domain);
  console.log(`[testForCatchall] result:`, result);
  return result.ok === true;
}
