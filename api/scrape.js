export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  let { url, crd, name, city } = req.query;
  if (!crd) {
    res.status(400).json({ error: 'Missing required parameter: crd' });
    return;
  }

  const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

  const BLOCKED_DOMAINS = [
    'linkedin.com','facebook.com','twitter.com','instagram.com','youtube.com',
    'google.com','bing.com','yahoo.com','duckduckgo.com',
    'wix.com','wixsite.com','squarespace.com','weebly.com','godaddy.com',
    'wordpress.com','blogger.com','tumblr.com',
    'sec.gov','finra.org','brokercheck.finra.org',
    'yelp.com','bbb.org','manta.com','yellowpages.com','mapquest.com',
    'angieslist.com','thumbtack.com','bark.com','expertise.com','smartasset.com',
    'advisoryhq.com','wealthminder.com','napfa.org','cfp.net',
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
      || !d.includes('.')
          || /\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|zip|css|js|woff|ttf|eot)$/i.test(d);
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
      if (isBlockedDomain(r.url)) return null;
      return await r.text();
    } catch { clearTimeout(timer); return null; }
  }

  // Search Brave for the firm's real website
  async function findWebsiteViaBrave(firmName, firmCity) {
    if (!BRAVE_API_KEY) {
      console.log('[scrape] No BRAVE_API_KEY set');
      return null;
    }
    const query = `"${firmName}" ${firmCity} financial advisor`;
    const searchUrl = 'https://api.search.brave.com/res/v1/web/search?'
      + new URLSearchParams({ q: query, count: 5, search_lang: 'en', country: 'us' });
    try {
      const r = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': BRAVE_API_KEY,
        }
      });
      if (!r.ok) {
        console.log('[scrape] Brave API error:', r.status, await r.text());
        return null;
      }
      const data = await r.json();
      const results = data?.web?.results || [];
      // Return first URL that isn't a blocked domain
      for (const result of results) {
        const u = result.url;
        if (u && !isBlockedDomain(u)) return u;
      }
      return null;
    } catch(e) {
      console.log('[scrape] Brave search error:', e.message);
      return null;
    }
  }

  // Scrape a website across multiple pages for emails
  async function scrapeForEmails(websiteUrl) {
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

  // Step 1: Resolve website URL
  if (url && url.startsWith('https//')) url = url.replace('https//', 'https://'); else if (url && url.startsWith('http//')) url = url.replace('http//', 'http://'); else if (url && !url.startsWith('http')) url = 'https://' + url;
  let websiteUrl = (url && url.startsWith('http') && !isBlockedDomain(url)) ? url : null;
  let websiteSource = 'csv';

  // If no usable URL, search Brave for the real website
  if (!websiteUrl) {
    if (name && city && BRAVE_API_KEY) {
      console.log('[scrape] Searching Brave for:', name, city);
      websiteUrl = await findWebsiteViaBrave(name, city);
      websiteSource = websiteUrl ? 'brave' : 'none';
    } else {
      websiteSource = 'none';
    }
  }

  if (!websiteUrl) {
    return res.status(200).json({
      success: false, contacts: [], emails: [],
      error: !BRAVE_API_KEY ? 'No BRAVE_API_KEY configured' : 'Could not find a website for this firm',
      crd, websiteSource: 'none'
    });
  }

  // Step 2: Scrape the resolved website
  let contacts = await scrapeForEmails(websiteUrl);

  // Step 3: If CSV URL found no emails, try Brave as fallback
  if (contacts.length === 0 && websiteSource === 'csv' && name && city && BRAVE_API_KEY) {
    console.log('[scrape] No emails on CSV site, trying Brave fallback');
    const braveUrl = await findWebsiteViaBrave(name, city);
    if (braveUrl && braveUrl !== websiteUrl) {
      const braveContacts = await scrapeForEmails(braveUrl);
      if (braveContacts.length > 0) {
        contacts = braveContacts;
        websiteUrl = braveUrl;
        websiteSource = 'brave-fallback';
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
