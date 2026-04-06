/**
 * /api/scrape.js
 * 
 * Vercel serverless function for email scraping
 * Fetches a firm's website and extracts email addresses
 * 
 * Usage: GET /api/scrape.js?url=https://example.com&crd=12345
 * 
 * Deploy: Copy this file to your repo at /api/scrape.js
 * Vercel will automatically deploy it as a serverless function
 */

export default async function handler(req, res) {
  const { url, crd } = req.query;

  // Validate inputs
  if (!url || !crd) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: url, crd'
    });
  }

  try {
    // Validate URL
    let targetUrl;
    try {
      targetUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Endpoints to try (in order of likelihood)
    const endpoints = ['/contact', '/about', ''];
    let emails = [];
    let successUrl = null;

    // Try each endpoint
    for (const endpoint of endpoints) {
      try {
        const fetchUrl = new URL(targetUrl.toString());
        if (endpoint) {
          fetchUrl.pathname = (fetchUrl.pathname.endsWith('/') ? fetchUrl.pathname : fetchUrl.pathname + '/') + endpoint.replace(/^\//, '');
        }

        const response = await fetch(fetchUrl.toString(), {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 5000
        });

        if (!response.ok) {
          continue;
        }

        const html = await response.text();

        // Regex to find emails
        // Matches: name@domain.ext format
        const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
        const found = html.match(emailRegex) || [];

        // Deduplicate and filter
        const uniqueEmails = [...new Set(found)]
          .filter(e => e && !e.endsWith('.gif') && !e.endsWith('.jpg') && !e.endsWith('.png'))
          .map(e => e.toLowerCase());

        if (uniqueEmails.length > 0) {
          emails = uniqueEmails;
          successUrl = fetchUrl.toString();
          break; // Stop at first success
        }
      } catch (e) {
        // Continue to next endpoint
        console.log(`Endpoint ${endpoint} failed:`, e.message);
        continue;
      }
    }

    // Return results
    return res.status(200).json({
      success: true,
      emails: emails,
      source: 'scrape',
      crd: crd,
      url: successUrl || url,
      scrapedAt: new Date().toISOString(),
      count: emails.length
    });

  } catch (error) {
    console.error('Scrape error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Unknown error',
      crd: crd
    });
  }
}
