export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { url, crd, name, city } = req.query;
  if (!crd) {
    res.status(400).json({ error: 'Missing required parameter: crd' });
    return;
  }

  const BLOCKED_DOMAINS = [
    'linkedin.com','facebook.com','twitter.com','instagram.com','youtube.com',
    'google.com','bing.com','yahoo.com','duckduckgo.com',
    'wix.com','wixsite.com','squarespace.com','weebly.com','godaddy.com',
    'wordpress.com','blogger.com','tumblr.com',
    'sec.gov','finra.org','brokercheck.finra.org',
    'yelp.com','bbb.org','manta.com','yellowpages.com','mapquest.com',
    'angieslist.com','thumbtack.com','bark.com','expertise.com',
  ];

  const JUNK_EMAIL_DOMAINS = [
    'sentry.io','example.com','domain.com','wixpress','fontawesome',
    'googleapis','gstatic','adobe','cloudflare','schema.org',
    'noreply','no-reply','placeholder','w3.org','sampleemail',
    'latofonts','typekit','linkedin','facebook','twitter','instagram',
    'lingying','jubao','yourname','company.com','emailaddress',
  ];

  const EMAIL_REGEX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const NOT_NAME = /\b(email|contact|phone|fax|address|office|suite|floor|street|ave|blvd|at|or|and|for|the|our|your|please|send|reach|us|me|info|team|staff|support|services|wealth|capital|financial|investment|management|advisor|director|president|partner|associate|analyst|assistant|manager)\b/i;

  function isBlockedDomain(urlStr) {
    try {
      const host = new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '');
      return BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    } catch { return true; }
  }

  function isJunkEmail(email) {
    const d = email.split('@')[1]?.toLowerCase() || '';
    return JUNK_EMAIL_DOMAINS.some(j => d.includes(j) || email.toLowerCase().includes(j))
      || email.includes('..')
      || email.length > 80
      || !d.includes('.');
  }

  function extractEmailsWithNames(html) {
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
      if (isJunkEmail(email)) continue;
      if (seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());

      const ctxStart = Math.max(0, m.index - 400);
      const ctxEnd = Math.min(html.length, m.index + email.length + 400);
      const plain = html.slice(ctxStart, ctxEnd)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ').trim();

      let name = null;
      const emailIdx = plain.indexOf(email);
      if (emailIdx !== -1) {
        const before = plain.slice(Math.max(0, emailIdx - 80), emailIdx);
        const bm = before.match(/([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})\s*[:\-,]?\s*$/);
        if (bm && !NOT_NAME.test(bm[1])) name = bm[1];

        if (!name) {
          const after = plain.slice(emailIdx + email.length, emailIdx + email.length + 80);
          const am = after.match(/^[\s,\-–|]*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})/);
          if (am && !NOT_NAME.test(am[1])) name = am[1];
        }
      }

      if (!name) {
        const parts = email.split('@')[0].split(/[._\-]/)
          .filter(p => p.length > 1 && /^[a-z]+$/i.test(p) && !NOT_NAME.test(p));
        if (parts.length >= 2)
          name = parts.slice(0, 2).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
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
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });
      clearTimeout(timer);
      if (!r.ok) return null;
      if (isBlockedDomain(r.url)) return null; // redirected to blocked domain
      return await r.text();
    } catch { clearTimeout(timer); return null; }
  }

  // Search DuckDuckGo for the firm's real website
  async function findWebsiteViaDDG(firmName, firmCity) {
    const query = `"${firmName}" ${firmCity} financial advisor`;
    const ddgUrl = 'https://lite.duckduckgo.com/lite/?' + new URLSearchParams({ q: query });
    try {
      const html = await fetchPage(ddgUrl, 6000);
      if (!html) return null;

      // Extract result URLs from DDG lite HTML
      const linkMatches = [...html.matchAll(/href="(https?:\/\/[^"&]+)"/g)];
      const candidates = linkMatches
        .map(m => m[1])
        .filter(u => {
          try {
            const host = new URL(u).hostname.toLowerCase();
            return !isBlockedDomain(u)
              && !host.includes('duckduckgo')
              && !host.includes('duck.com');
          } catch { return false; }
        });

      // Return the first non-blocked result
      return candidates[0] || null;
    } catch { return null; }
  }

  // Scrape a website for emails across multiple pages
  async function scrapeWebsiteForEmails(websiteUrl) {
    let origin;
    try { origin = new URL(websiteUrl).origin; } catch { return []; }

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
        for (const c of extractEmailsWithNames(html)) {
          if (!seenEmails.has(c.email.toLowerCase())) {
            seenEmails.add(c.email.toLowerCase());
            allContacts.push(c);
          }
        }
        if (allContacts.length >= 5) break;
      }
    }
    return allContacts;
  }

  // --- Main logic ---

  // Step 1: Determine the website to scrape
  let websiteUrl = url && url.startsWith('http') ? url : null;
  let websiteSource = 'csv';

  // If no URL provided, or URL is a blocked/social domain, search DDG
  if (!websiteUrl || isBlockedDomain(websiteUrl)) {
    if (name && city) {
      console.log('[scrape] No usable URL, searching DDG for:', name, city);
      websiteUrl = await findWebsiteViaDDG(name, city);
      websiteSource = 'ddg';
    }
  }

  if (!websiteUrl) {
    return res.status(200).json({
      success: false, contacts: [], emails: [],
      error: 'Could not find a website for this firm', crd,
      websiteSource: 'none'
    });
  }

  // Step 2: Scrape the website
  const contacts = await scrapeWebsiteForEmails(websiteUrl);

  // Step 3: If CSV website had no emails, try DDG as fallback
  if (contacts.length === 0 && websiteSource === 'csv' && name && city) {
    console.log('[scrape] No emails on CSV website, trying DDG fallback');
    const ddgUrl = await findWebsiteViaDDG(name, city);
    if (ddgUrl && ddgUrl !== websiteUrl) {
      const ddgContacts = await scrapeWebsiteForEmails(ddgUrl);
      if (ddgContacts.length > 0) {
        return res.status(200).json({
          success: true,
          contacts: ddgContacts,
          emails: ddgContacts.map(c => c.email),
          source: 'scrape',
          websiteSource: 'ddg-fallback',
          websiteFound: ddgUrl,
          crd, url: ddgUrl,
          scrapedAt: new Date().toISOString(),
          count: ddgContacts.length
        });
      }
    }
  }

  res.status(200).json({
    success: true,
    contacts,
    emails: contacts.map(c => c.email),
    source: 'scrape',
    websiteSource,
    websiteFound: websiteUrl,
    crd,
    url: websiteUrl,
    scrapedAt: new Date().toISOString(),
    count: contacts.length
  });
}
