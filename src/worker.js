/**
 * Salt Lake County Property Owner Scraper
 * Cloudflare Worker for scraping owner names from assessor website
 * Data is sent back to local server for SQLite storage
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Handle different endpoints
      switch (path) {
        case '/scrape':
          return await handleScrapeRequest(request, env);
        case '/status':
          return await handleStatusRequest(env);
        case '/batch':
          return await handleBatchRequest(request, env);
        default:
          return new Response('Salt Lake County Owner Scraper API\nData Storage: Local SQLite', { status: 200 });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Handle single parcel scraping request
 */
async function handleScrapeRequest(request, env) {
  const url = new URL(request.url);
  const parcelId = url.searchParams.get('parcel_id');
  
  if (!parcelId) {
    return new Response(JSON.stringify({ error: 'parcel_id parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const ownerData = await scrapeParcelOwner(parcelId);
    
    // Send data to local collection server
    await sendToLocalServer(env, parcelId, ownerData);

    return new Response(JSON.stringify({
      parcel_id: parcelId,
      ...ownerData,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to scrape parcel',
      parcel_id: parcelId,
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle batch scraping request
 */
async function handleBatchRequest(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { parcel_ids, worker_id = 'default', delay = 10 } = await request.json(); // Reduced to absolute minimum 10ms
  
  if (!parcel_ids || !Array.isArray(parcel_ids)) {
    return new Response(JSON.stringify({ error: 'parcel_ids array required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const results = [];
  const errors = [];

  // Process parcels in parallel batches for maximum speed
  const PARALLEL_BATCH_SIZE = 10; // Process 10 parcels simultaneously
  
  for (let i = 0; i < parcel_ids.length; i += PARALLEL_BATCH_SIZE) {
    const batch = parcel_ids.slice(i, i + PARALLEL_BATCH_SIZE);
    
    // Process this batch in parallel
    const batchPromises = batch.map(async (parcelId, index) => {
      try {
        console.log(`Worker ${worker_id}: Processing parcel ${i + index + 1}/${parcel_ids.length}: ${parcelId}`);
        
        const ownerData = await scrapeParcelOwner(parcelId);
        
        // Send data to local collection server
        await sendToLocalServer(env, parcelId, ownerData);

        return {
          success: true,
          data: {
            parcel_id: parcelId,
            ...ownerData,
            processed_at: new Date().toISOString()
          }
        };

      } catch (error) {
        console.error(`Error processing parcel ${parcelId}:`, error);
        return {
          success: false,
          data: {
            parcel_id: parcelId,
            error: error.message,
            processed_at: new Date().toISOString()
          }
        };
      }
    });
    
    // Wait for all parcels in this batch to complete
    const batchResults = await Promise.all(batchPromises);
    
    // Sort results
    batchResults.forEach(result => {
      if (result.success) {
        results.push(result.data);
      } else {
        errors.push(result.data);
      }
    });
    
    // Mini delay between parallel batches
    if (i + PARALLEL_BATCH_SIZE < parcel_ids.length) {
      await sleep(delay);
    }
  }

  return new Response(JSON.stringify({
    worker_id,
    total_processed: parcel_ids.length,
    successful: results.length,
    failed: errors.length,
    results,
    errors,
    completed_at: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Handle status request
 */
async function handleStatusRequest(env) {
  return new Response(JSON.stringify({
    status: 'operational',
    storage: 'local_sqlite',
    worker_id: env.WORKER_ID || 'unknown',
    timestamp: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Scrape owner information from Salt Lake County assessor website
 */
async function scrapeParcelOwner(parcelId) {
  const targetUrl = `https://apps.saltlakecounty.gov/assessor/new/valuationInfoExpanded.cfm?parcel_id=${parcelId}`;
  
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: Failed to fetch parcel data`);
  }

  const html = await response.text();
  
  // Extract owner information from HTML
  const ownerData = extractOwnerInfo(html);
  
  if (!ownerData.owner) {
    throw new Error('Could not extract owner information from page');
  }

  return ownerData;
}

/**
 * Extract owner information from HTML content
 */
function extractOwnerInfo(html) {
  // Look for the owner information in the table format
  const ownerRegex = /<td[^>]*scope="row"[^>]*>Owner\s*<\/td><td[^>]*>\s*([^<]+?)\s*<\/td>/i;
  const addressRegex = /<td[^>]*scope="row"[^>]*>Address<\/td><td[^>]*>\s*([^<]+?)\s*<\/td>/i;
  const acreageRegex = /<td[^>]*>Total Acreage<\/td><td[^>]*>.*?(\d+\.?\d*)\s*<\/a><\/td>/i;
  const propertyTypeRegex = /<td[^>]*>Property Type<\/td><td[^>]*>.*?>\s*([^<]+?)\s*<\/a><\/td>/i;
  const marketValueRegex = /(\d{4})\s*Market Value[^$]*\$\s*([\d,]+)/i;

  const ownerMatch = html.match(ownerRegex);
  const addressMatch = html.match(addressRegex);
  const acreageMatch = html.match(acreageRegex);
  const propertyTypeMatch = html.match(propertyTypeRegex);
  const marketValueMatch = html.match(marketValueRegex);

  const result = {
    owner: ownerMatch ? ownerMatch[1].trim() : null,
    address: addressMatch ? addressMatch[1].trim() : null,
    total_acreage: acreageMatch ? acreageMatch[1].trim() : null,
    property_type: propertyTypeMatch ? propertyTypeMatch[1].trim() : null,
    market_value: marketValueMatch ? marketValueMatch[2].replace(/,/g, '') : null,
    market_value_year: marketValueMatch ? marketValueMatch[1] : null
  };

  return result;
}

/**
 * Send scraped data to local collection server
 */
// Resolve collector base similarly to worker-independent.js (prefer COLLECTOR_BASE then LOCAL_COLLECTOR_URL)
function resolveCollectorBase(env) {
  let base = env.COLLECTOR_BASE;
  if (!base && env.LOCAL_COLLECTOR_URL) {
    try {
      const u = new URL(env.LOCAL_COLLECTOR_URL);
      if (u.pathname.endsWith('/collect')) {
        u.pathname = u.pathname.replace(/\/collect$/, '');
        base = u.origin + (u.pathname === '/' ? '' : u.pathname);
      } else {
        base = u.origin + (u.pathname === '/' ? '' : u.pathname);
      }
    } catch (_) {
      base = env.LOCAL_COLLECTOR_URL; // Use as-is if parse fails
    }
  }
  if (!base) base = 'http://localhost:3000';
  if (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}

async function sendToLocalServer(env, parcelId, ownerData) {
  const base = resolveCollectorBase(env);
  const collectorUrl = `${base}/collect`;

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.COLLECTOR_TOKEN || 'default-token'}`
    };
    if (env.COLLECTOR_SERVICE_TOKEN) {
    }

    const response = await fetch(collectorUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parcel_id: parcelId,
        worker_id: env.WORKER_ID,
        scraped_at: new Date().toISOString(),
        ...ownerData
      })
    });

    if (!response.ok) {
      throw new Error(`Local server error: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send to local server:', error);
    // Don't throw - we want to continue processing even if storage fails
  }
}

/**
 * Sleep utility function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}