export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, crd } = req.query;
  if (!url || !crd) {
    res.status(400).json({ error: 'Missing required parameters: url, crd' });
    return;
  }

  const EMAIL_REGEX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const JUNK_DOMAINS = [
    'sentry.io','example.com','domain.com','youremail','wixpress','squarespace',
    'wordpress','latofonts','fontawesome','googleapis','gstatic','adobe',
    'cloudflare','schema.org','noreply','no-reply','placeholder','test@',
    'w3.org','sampleemail','yourname','company.com','emailaddress'
  ];
  // Common words that are NOT names — stop name extraction before these
  const NOT_NAME_WORDS = /\b(email|contact|phone|fax|address|office|suite|floor|street|ave|blvd|rd|st|at|or|and|for|the|our|your|please|send|reach|us|me|him|her|them|manager|director|advisor|president|ceo|cfo|coo|partner|associate|analyst|assistant|receptionist|info|team|staff|support|services|wealth|capital|financial|investment|management)\b/i;

  function extractEmailsWithNames(html) {
    // Strip scripts, styles, and HTML comments
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    const results = [];
    const seen = new Set();
    let m;
    EMAIL_REGEX.lastIndex = 0;

    while ((m = EMAIL_REGEX.exec(html)) !== null) {
      const email = m[0];
      const domain = email.split('@')[1]?.toLowerCase() || '';

      // Filter junk
      if (JUNK_DOMAINS.some(j => domain.includes(j) || email.toLowerCase().includes(j))) continue;
      if (email.includes('..') || email.length > 80 || !domain.includes('.')) continue;
      if (seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());

      // Extract surrounding context (~400 chars each side)
      const ctxStart = Math.max(0, m.index - 400);
      const ctxEnd = Math.min(html.length, m.index + email.length + 400);
      const ctx = html.slice(ctxStart, ctxEnd);

      // Strip tags → plain text
      const plain = ctx
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ').trim();

      let name = null;
      const emailIdx = plain.indexOf(email);

      if (emailIdx !== -1) {
        // --- Try: name immediately BEFORE email in plain text ---
        const before = plain.slice(Math.max(0, emailIdx - 80), emailIdx);
        // Match last occurrence of "Firstname Lastname" (2-4 Title Case words, no junk words)
        const beforeMatch = before.match(/([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})\s*[:\-,]?\s*$/);
        if (beforeMatch) {
          const candidate = beforeMatch[1];
          // Reject if it contains non-name words
          if (!NOT_NAME_WORDS.test(candidate)) {
            name = candidate;
          }
        }

        // --- Try: name immediately AFTER email in plain text ---
        if (!name) {
          const after = plain.slice(emailIdx + email.length, emailIdx + email.length + 80);
          const afterMatch = after.match(/^[\s,\-–|]*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})/);
          if (afterMatch) {
            const candidate = afterMatch[1];
            if (!NOT_NAME_WORDS.test(candidate)) {
              name = candidate;
            }
          }
        }
      }

      // --- Fallback: parse name from email local part (john.smith@ → John Smith) ---
      if (!name) {
        const localPart = email.split('@')[0];
        const parts = localPart.split(/[._\-]/).filter(p => p.length > 1 && /^[a-z]+$/i.test(p) && !NOT_NAME_WORDS.test(p));
        if (parts.length >= 2) {
          // Looks like firstname.lastname format
          name = parts.slice(0, 2).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
        }
      }

      results.push({ email, name: name || null });
    }

    return results;
  }

  async function fetchPage(pageUrl, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const r = await fetch(pageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      return await r.text();
    } catch { clearTimeout(timer); return null; }
  }

  // Normalize URL
  let websiteUrl = url;
  if (!websiteUrl.startsWith('http')) websiteUrl = 'https://' + websiteUrl;

  let origin;
  try { origin = new URL(websiteUrl).origin; }
  catch { res.status(400).json({ error: 'Invalid URL', url }); return; }

  // Try contact/about pages first, then homepage
  const pagesToTry = [
    origin + '/contact',
    origin + '/contact-us',
    origin + '/about',
    origin + '/about-us',
    websiteUrl,
    origin,
  ];

  const allContacts = [];
  const seenEmails = new Set();

  for (const pageUrl of pagesToTry) {
    const html = await fetchPage(pageUrl);
    if (html) {
      const found = extractEmailsWithNames(html);
      for (const contact of found) {
        if (!seenEmails.has(contact.email.toLowerCase())) {
          seenEmails.add(contact.email.toLowerCase());
          allContacts.push(contact);
        }
      }
      if (allContacts.length >= 5) break;
    }
  }

  res.status(200).json({
    success: true,
    contacts: allContacts,
    // Legacy field for backwards compat
    emails: allContacts.map(c => c.email),
    source: 'scrape',
    crd,
    url: websiteUrl,
    scrapedAt: new Date().toISOString(),
    count: allContacts.length
  });
}
