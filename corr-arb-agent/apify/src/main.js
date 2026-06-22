import { Actor } from 'apify';
import { CheerioCrawler } from 'crawlee';

await Actor.init();

const record = {
    scraped_at: new Date().toISOString(),
    fear_greed_value: null,
    fear_greed_label: null,
    btc_funding_rate_pct: null,
    eth_funding_rate_pct: null,
    reddit_sentiment: null,
    reddit_top_posts: [],
    coindesk_headlines: [],
    cointelegraph_headlines: [],
    market_regime: null,
    combined_sentiment: null
};

// Source 1: Alternative.me Fear & Greed
try {
    const response = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await response.json();
    if (data && data.data && data.data.length > 0) {
        record.fear_greed_value = parseInt(data.data[0].value, 10);
        record.fear_greed_label = data.data[0].value_classification;
        
        if (record.fear_greed_value > 60) {
            record.market_regime = "risk_on";
        } else if (record.fear_greed_value < 40) {
            record.market_regime = "risk_off";
        } else {
            record.market_regime = "neutral";
        }
    }
} catch (error) {
    console.error('Source 1 (Fear & Greed) failed:', error.message);
}

// Source 2: Reddit r/CryptoCurrency
try {
    const response = await fetch('https://www.reddit.com/r/CryptoCurrency/hot.json?limit=10', {
        headers: { 'User-Agent': 'HedgeFlow-Macro-Scraper/1.0' }
    });
    const data = await response.json();
    const posts = data.data.children.map(c => ({
        title: c.data.title,
        score: c.data.score
    }));
    record.reddit_top_posts = posts.map(p => p.title).slice(0, 5);
    
    // Sentiment calculation
    const bullishKeywords = ['moon', 'pump', 'bull', 'ATH', 'surge', 'rally', 'breakout'];
    const bearishKeywords = ['crash', 'dump', 'bear', 'rug', 'sell', 'fear', 'collapse'];
    
    let bullCount = 0;
    let bearCount = 0;
    
    for (const post of posts) {
        const titleLower = post.title.toLowerCase();
        for (const kw of bullishKeywords) {
            if (titleLower.includes(kw.toLowerCase())) bullCount++;
        }
        for (const kw of bearishKeywords) {
            if (titleLower.includes(kw.toLowerCase())) bearCount++;
        }
    }
    
    if (bullCount > bearCount) record.reddit_sentiment = 'bullish';
    else if (bearCount > bullCount) record.reddit_sentiment = 'bearish';
    else record.reddit_sentiment = 'neutral';
    
} catch (error) {
    console.error('Source 2 (Reddit) failed:', error.message);
}

// Scrape CoinDesk & CoinTelegraph RSS with CheerioCrawler
const rssCrawler = new CheerioCrawler({
    async requestHandler({ $, request }) {
        const headlines = [];
        $('item > title').each((i, el) => {
            headlines.push($(el).text());
        });
        
        if (request.url.includes('coindesk')) {
            record.coindesk_headlines = headlines.slice(0, 8);
        } else if (request.url.includes('cointelegraph')) {
            record.cointelegraph_headlines = headlines.slice(0, 8);
        }
    },
    failedRequestHandler({ request }) {
        console.error(`RSS scrape failed for ${request.url}`);
    }
});

try {
    await rssCrawler.run([
        'https://www.coindesk.com/arc/outboundfeeds/rss/',
        'https://cointelegraph.com/rss'
    ]);
} catch (error) {
    console.error('Source 3/4 (RSS Feeds) failed:', error.message);
}

// Source 5: Binance Funding Rates
try {
    const [btcResponse, ethResponse] = await Promise.all([
        fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1'),
        fetch('https://fapi.binance.com/fapi/v1/fundingRate?symbol=ETHUSDT&limit=1')
    ]);
    
    const btcData = await btcResponse.json();
    const ethData = await ethResponse.json();
    
    if (btcData && btcData.length > 0) {
        record.btc_funding_rate_pct = parseFloat(btcData[0].fundingRate) * 100;
    }
    if (ethData && ethData.length > 0) {
        record.eth_funding_rate_pct = parseFloat(ethData[0].fundingRate) * 100;
    }
} catch (error) {
    console.error('Source 5 (Binance) failed:', error.message);
}

// Calculate combined sentiment
try {
    const bullishKeywords = ['moon', 'pump', 'bull', 'ATH', 'surge', 'rally', 'breakout'];
    const bearishKeywords = ['crash', 'dump', 'bear', 'rug', 'sell', 'fear', 'collapse'];
    
    let bullVotes = 0;
    let bearVotes = 0;
    
    if (record.reddit_sentiment === 'bullish') bullVotes++;
    if (record.reddit_sentiment === 'bearish') bearVotes++;
    
    const allHeadlines = [...(record.coindesk_headlines || []), ...(record.cointelegraph_headlines || [])];
    let hdBull = 0;
    let hdBear = 0;
    
    for (const hd of allHeadlines) {
        const lower = hd.toLowerCase();
        for (const kw of bullishKeywords) {
            if (lower.includes(kw.toLowerCase())) hdBull++;
        }
        for (const kw of bearishKeywords) {
            if (lower.includes(kw.toLowerCase())) hdBear++;
        }
    }
    
    if (hdBull > hdBear) bullVotes++;
    if (hdBear > hdBull) bearVotes++;
    
    if (bullVotes > bearVotes) record.combined_sentiment = 'bullish';
    else if (bearVotes > bullVotes) record.combined_sentiment = 'bearish';
    else record.combined_sentiment = 'neutral';
    
} catch (error) {
    console.error('Failed to calculate combined sentiment:', error.message);
}

// Push results to Apify Dataset
await Actor.pushData(record);

await Actor.exit();
