import dns from 'dns';
import SMTPConnection from 'nodemailer/lib/smtp-connection/index.js';
import util from 'util';

const dnsResolveMx = util.promisify(dns.resolveMx);

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} ok            – true only if RCPT-TO was accepted
 * @property {boolean} rejected      – true only if RCPT-TO was explicitly rejected (5xx)
 * @property {'no_mx'|'dns_error'|'handshake_error'|'recipient_rejected'|'check_error'|'accepted'} reason
 * @property {string=} error         – raw error message for DNS/handshake/RCPT failures
 * @property {number} latencyMs      – round-trip time in ms
 */

/**
 * Attempt to verify a single address via SMTP RCPT-TO, with one retry on 4xx.
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
    console.log(`[verifyEmail] DNS lookup error:`, err);
    return { ok: false, rejected: false, reason: 'dns_error', error: err.message, latencyMs: latency };
  }

  // pick best MX
  mxRecords.sort((a, b) => a.priority - b.priority);
  const mxHost = mxRecords[0].exchange;
  console.log(`[verifyEmail] selected MX host: ${mxHost}`);

  // We'll allow one RCPT retry on 4xx before giving up:
  const maxAttempts = 2;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const conn = new SMTPConnection({
      host: mxHost,
      port: 25,
      secure: false,
      logger: true,
      debug: true,
      connectionTimeout: 5_000,
      greetingTimeout:  5_000,
      socketTimeout:    5_000,
    });

    try {
      console.log(`[verifyEmail] handshake attempt #${attempt} with ${mxHost}`);
      // establish connection & EHLO
      await new Promise((resolve, reject) =>
        conn.connect(err => err ? reject(err) : resolve())
      );

      console.log(`[verifyEmail] sending envelope to <${full}>`);
      // this issues MAIL FROM + RCPT TO under the hood
      await new Promise((resolve, reject) =>
        conn.send(
          { from: `verifier@${domain}`, to: [full] },
          '', // no message body
          (err, info) => err ? reject(err) : resolve(info)
        )
      );

      console.log(`[verifyEmail] RCPT-TO accepted`);
      await new Promise(resolve => conn.quit(resolve));

      const latency = Date.now() - start;
      return { ok: true, rejected: false, reason: 'accepted', latencyMs: latency };
    } catch (err) {
      lastErr = err;
      const code = err.responseCode;

      // 5xx = hard reject
      if (code >= 500 && code < 600) {
        console.log(`[verifyEmail] recipient explicitly rejected (code=${code})`);
        try { conn.close(); } catch {}
        const latency = Date.now() - start;
        return { ok: false, rejected: true, reason: 'recipient_rejected', latencyMs: latency };
      }

      // 4xx = grey-list/timeout, maybe retry
      console.log(
        `[verifyEmail] RCPT-TO deferral (code=${code}), ${attempt < maxAttempts ? 'retrying' : 'giving up'}`,
        err
      );
      try { conn.close(); } catch {}

      if (attempt < maxAttempts) {
        // exponential back-off: 5s, then 10s...
        const wait = 5_000 * attempt;
        await new Promise(r => setTimeout(r, wait));
        continue;
      } else {
        const latency = Date.now() - start;
        return { ok: false, rejected: false, reason: 'check_error', error: lastErr.message, latencyMs: latency };
      }
    }
  }

  // fallback (should never hit)
  const latency = Date.now() - start;
  return { ok: false, rejected: false, reason: 'check_error', error: lastErr?.message, latencyMs: latency };
}

/**
 * Test for catch-all by RCPT-TO a known-fake address.
 */
export async function testForCatchall(domain) {
  const randomStr = Math.random().toString(36).slice(2, 10);
  const fakeLocal = `noone-${randomStr}`;
  const fakeFull  = `${fakeLocal}@${domain}`;
  console.log(`[testForCatchall] probing ${fakeFull}`);
  const result = await verifyEmail(fakeLocal, domain);
  console.log(`[testForCatchall] result:`, result);
  return result.ok === true;
}
