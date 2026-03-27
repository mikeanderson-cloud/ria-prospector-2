export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { path, ...rest } = req.query;
  if (!path) {
    res.status(400).json({ error: 'Missing path parameter' });
    return;
  }

  const cleanParams = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== null && v !== '') cleanParams[k] = v;
  }

  const params = new URLSearchParams(cleanParams).toString();
  const secUrl = `https://www.adviserinfo.sec.gov/api/crd/${path}${params ? '?' + params : ''}`;

  console.log('[sec-proxy] Fetching:', secUrl);

  try {
    const response = await fetch(secUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.adviserinfo.sec.gov/',
      }
    });

    console.log('[sec-proxy] SEC responded with status:', response.status);

    const text = await response.text();

    try {
      const data = JSON.parse(text);
      res.status(response.status).json(data);
    } catch {
      console.error('[sec-proxy] Non-JSON body:', text.slice(0, 300));
      res.status(502).json({
        error: 'SEC returned non-JSON',
        secStatus: response.status,
        preview: text.slice(0, 300)
      });
    }
  } catch (err) {
    console.error('[sec-proxy] Network error:', err.message);
    res.status(500).json({ error: 'Fetch failed', detail: err.message });
  }
}
