export default async function handler(req, res) {
  // Allow requests from your Vercel app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Build the SEC URL from whatever path/query the client sends
  // e.g. /api/sec?path=firms/search&query=...&state=CA&type=IA&from=0&size=100
  const { path, ...rest } = req.query;
  if (!path) {
    res.status(400).json({ error: 'Missing path parameter' });
    return;
  }

  const params = new URLSearchParams(rest).toString();
  const secUrl = `https://www.adviserinfo.sec.gov/api/crd/${path}${params ? '?' + params : ''}`;

  try {
    const response = await fetch(secUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; RIA-Prospector/1.0)',
      }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy fetch failed', detail: err.message });
  }
}
