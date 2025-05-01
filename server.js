import express from 'express';
import { verifyEmail, testForCatchall } from './verify.js';

const app = express();
app.use(express.json());

// POST /verify
// body: { email: "local@domain", domain: "domain" }
app.post('/verify', async (req, res) => {
  const { email, domain } = req.body;
  if (!email || !domain) {
    return res.status(400).json({ error: 'email & domain required' });
  }

  // split full address if they sent it, otherwise use the passed-in domain
  const [local, dom] = email.includes('@')
    ? email.split('@', 2)
    : [email, domain];

  try {
    const result = await verifyEmail(local, dom);
    return res.json(result);
  } catch (err) {
    console.error('[/verify] error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /test-catchall
// body: { domain: "domain" }
app.post('/test-catchall', async (req, res) => {
  const { domain } = req.body;
  if (!domain) {
    return res.status(400).json({ error: 'domain required' });
  }

  try {
    const ok = await testForCatchall(domain);
    return res.json({ ok });
  } catch (err) {
    console.error('[/test-catchall] error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Verifier listening on port ${port}`));
