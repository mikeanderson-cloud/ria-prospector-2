export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url } = req.query;
  if (!url) { res.status(400).json({ error: 'Missing url parameter' }); return; }

  let targetUrl;
  try {
    targetUrl = new URL(url);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) throw new Error('Invalid protocol');
    const host = targetUrl.hostname.toLowerCase();
    if (host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.') || host.startsWith('10.') || host.endsWith('.local')) {
      return res.status(400).json({ error: 'Private URL not allowed' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const JUNK_EMAIL = /noreply|no-reply|donotreply|example\.com|test@|@sentry|@w3|unsubscribe|privacy@|legal@|support@|info@wix|info@squarespace/i;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const base = targetUrl.origin;
  const pagesToTry = [
    base + '/contact',
    base + '/contact-us',
    base + '/about',
    base + '/team',
    base,
  ];

  const emails = new Set();
  let pagesChecked = 0;
  let lastError = null;

  for (const pageUrl of pagesToTry) {
    if (emails.size >= 3) break;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(pageUrl, { headers, signal: controller.signal, redirect: 'follow' });
      clearTimeout(timeout);

      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('html') && !ct.includes('text')) continue;

      const text = await resp.text();
      pagesChecked++;

      const found = text.match(EMAIL_RE) || [];
      found.forEach(e => {
        const lower = e.toLowerCase();
        if (!JUNK_EMAIL.test(lower) && lower.length < 80) emails.add(lower);
      });

      const decoded = text
        .replace(/&#64;/g, '@').replace(/&#x40;/g, '@')
        .replace(/\[at\]/gi, '@').replace(/\(at\)/gi, '@')
        .replace(/\[dot\]/gi, '.').replace(/\(dot\)/gi, '.');
      const decoded_found = decoded.match(EMAIL_RE) || [];
      decoded_found.forEach(e => {
        const lower = e.toLowerCase();
        if (!JUNK_EMAIL.test(lower) && lower.length < 80) emails.add(lower);
      });

      if (emails.size > 0) break;
    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  const emailList = [...emails].slice(0, 5);

  res.status(200).json({
    url: base,
    emails: emailList,
    found: emailList.length > 0,
    pagesChecked,
    ...(emailList.length === 0 && lastError ? { hint: 'Could not fetch site: ' + lastError } : {})
  });
}
