import express from 'express';
import { verifyEmail } from './verify.js';

const app = express();
app.use(express.json());

app.post('/verify', async (req, res) => {
  const { email, domain } = req.body;
  if (!email || !domain) {
    return res.status(400).json({ error: 'email & domain required' });
  }
  try {
    const ok = await verifyEmail(email, domain);
    res.json({ ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Verifier listening on port ${port}`));
