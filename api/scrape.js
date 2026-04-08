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

  // Domains blocked when selecting a URL (Brave results, CSV validation)
  // but NOT when following redirects from a firm's own site
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

  // Junk email domains — use exact domain / suffix matching (not substring)
  const JUNK_EMAIL_DOMAINS = [
    'sentry.io','example.com','domain.com','wixpress.com','fontawesome.com',
    'googleapis.com','gstatic.com','adobe.com','cloudflare.com','schema.org',
    'w3.org','sampleemail.com','latofonts.com','typekit.com',
    'linkedin.com','facebook.com','twitter.com','instagram.com',
    'company.com','emailaddress.com','yourname.com',
  ];
  // Substrings that are always junk when found anywhere in an email address
  const JUNK_EMAIL_SUBSTRINGS = [
    'noreply','no-reply','placeholder','lingying','jubao',
  ];

  const EMAIL_REGEX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const MAILTO_REGEX = /href\s*=\s*["']mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/gi;
  const NOT_NAME = /\b(email|contact|phone|fax|address|office|suite|floor|street|ave|blvd|at|or|and|for|the|our|your|please|send|reach|us|me|info|team|staff|support|services)\b/i;

  function isBlockedDomain(urlStr) {
    try {
      const host = new URL(urlStr).hostname.toLowerCase().replace(/^www\./, '');
      return BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d));
    } catch { return true; }
  }

  function isJunkEmail(email) {
    const lower = email.toLowerCase();
    const d = lower.split('@')[1] || '';
    if (!d.includes('.')) return true;
    if (email.includes('..')) return true;
    if (email.length > 80) return true;
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|zip|css|js|woff|ttf|eot)$/i.test(d)) return true;
    // Exact domain or suffix matching
    if (JUNK_EMAIL_DOMAINS.some(j => d === j || d.endsWith('.' + j))) return true;
    // Substring matching only for always-junk patterns
    if (JUNK_EMAIL_SUBSTRINGS.some(j => lower.includes(j))) return true;
    return false;
  }

  // Decode HTML entities and common anti-spam obfuscation
  function decodeEntities(html) {
    return html
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\s*\(at\)\s*/gi, '@').replace(/\s*\[at\]\s*/gi, '@')
      .replace(/\s*\(dot\)\s*/gi, '.').replace(/\s*\[dot\]\s*/gi, '.');
  }

  function extractEmailsWithNames(html) {
    const results = [];
    const seen = new Set();

    function addEmail(email, nameGuess) {
      if (isJunkEmail(email)) return;
      if (seen.has(email.toLowerCase())) return;
      seen.add(email.toLowerCase());
      results.push({ email, name: nameGuess || null });
    }

    // Pass 1: Extract high-confidence mailto: links before any stripping
    let mm;
    MAILTO_REGEX.lastIndex = 0;
    while ((mm = MAILTO_REGEX.exec(html)) !== null) {
      addEmail(mm[1], null);
    }

    // Pass 2: Extract emails from script tags (JSON-LD, inline data, JS vars)
    const scriptBlocks = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const block of scriptBlocks) {
      const content = decodeEntities(
        block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '')
      );
      EMAIL_REGEX.lastIndex = 0;
      let sm;
      while ((sm = EMAIL_REGEX.exec(content)) !== null) {
        addEmail(sm[0], null);
      }
    }

    // Pass 3: Main extraction from visible HTML (strip scripts/styles first)
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Decode entities and obfuscation patterns
    html = decodeEntities(html);

    EMAIL_REGEX.lastIndex = 0;
    let m;
    while ((m = EMAIL_REGEX.exec(html)) !== null) {
      const email = m[0];
      if (isJunkEmail(email)) continue;
      if (seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());

      // Try to find a name near the email
      const ctxStart = Math.max(0, m.index - 400);
      const ctxEnd = Math.min(html.length, m.index + email.length + 400);
      const plain = html.slice(ctxStart, ctxEnd)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ').trim();

      let ename = null;
      const emailIdx = plain.indexOf(email);
      if (emailIdx !== -1) {
        const before = plain.slice(Math.max(0, emailIdx - 80), emailIdx);
        const bm = before.match(/([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})\s*[:\-,]?\s*$/);
        if (bm && !NOT_NAME.test(bm[1])) ename = bm[1];

        if (!ename) {
          const after = plain.slice(emailIdx + email.length, emailIdx + email.length + 80);
          const am = after.match(/^[\s,\-\u2013|]*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})/);
          if (am && !NOT_NAME.test(am[1])) ename = am[1];
        }
      }

      if (!ename) {
        const parts = email.split('@')[0].split(/[._\-]/)
          .filter(p => p.length > 1 && /^[a-z]+$/i.test(p) && !NOT_NAME.test(p));
        if (parts.length >= 2)
          ename = parts.slice(0, 2).map(p => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');
      }

      results.push({ email, name: ename || null });
    }
    return results;
  }

  async function fetchPage(pageUrl, timeout = 12000) {
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
      // Skip binary responses
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('text/') && !ct.includes('html') && !ct.includes('xml') && !ct.includes('json')) return null;
      // NOTE: We no longer block after redirect — domain blocking applies to
      // URL selection (Brave results, CSV validation), not to page fetching.
      // A firm's own site legitimately redirects to Wix/Squarespace/etc.
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

  // Collect unique contacts from HTML, deduplicating by email
  function collectContacts(html, allContacts, seenEmails) {
    if (!html) return;
    for (const c of extractEmailsWithNames(html)) {
      if (!seenEmails.has(c.email.toLowerCase())) {
        seenEmails.add(c.email.toLowerCase());
        allContacts.push(c);
      }
    }
  }

  // Scrape a website across multiple pages for emails (parallel, tiered)
  async function scrapeForEmails(websiteUrl) {
    let origin;
    try { origin = new URL(websiteUrl).origin; } catch { return []; }

    const allContacts = [];
    const seenEmails = new Set();

    // Tier 1: Most common contact/about/team pages (fetched in parallel)
    const tier1 = [
      origin + '/contact',
      origin + '/contact-us',
      origin + '/about',
      origin + '/about-us',
      origin + '/team',
      origin + '/our-team',
    ];

    const tier1Results = await Promise.allSettled(tier1.map(u => fetchPage(u)));
    for (const r of tier1Results) {
      if (r.status === 'fulfilled' && r.value) {
        collectContacts(r.value, allContacts, seenEmails);
      }
    }

    if (allContacts.length >= 5) return allContacts;

    // Tier 2: Additional pages + the original URL and origin (parallel)
    const tier2 = [
      origin + '/advisors',
      origin + '/our-advisors',
      origin + '/people',
      origin + '/staff',
      origin + '/professionals',
      origin + '/leadership',
      websiteUrl,
      origin,
    ];

    const tier2Results = await Promise.allSettled(tier2.map(u => fetchPage(u)));
    for (const r of tier2Results) {
      if (r.status === 'fulfilled' && r.value) {
        collectContacts(r.value, allContacts, seenEmails);
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
