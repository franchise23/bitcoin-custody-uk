const https = require('https');
const symbols = ['ES=F', 'NQ=F', 'YM=F', '^RTY', 'BTC-USD', 'GC=F', 'SI=F', 'CL=F', '^GSPC', '^DJI', '^IXIC'];

function fetchJson(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  for (const symbol of symbols) {
    const payload = await fetchJson(symbol);
    const result = payload && payload.chart && payload.chart.result && payload.chart.result[0] ? payload.chart.result[0] : {};
    const meta = result.meta || {};
    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0] ? result.indicators.quote[0] : {};
    const closes = quote.close || [];
    const lastClose = Number(closes[closes.length - 1] ?? meta.chartPreviousClose ?? meta.previousClose ?? NaN);
    const price = Number(meta.regularMarketPrice ?? lastClose ?? NaN);
    const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? lastClose ?? NaN);
    const change = Number.isFinite(Number(meta.regularMarketChangePercent))
      ? Number(meta.regularMarketChangePercent)
      : Number.isFinite(price) && Number.isFinite(previousClose) && previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : NaN;
    console.log(`${symbol} => price=${price} change=${change}`);
  }
})();
