/**
 * Performance Test Worker - Independent Scraper
 * 
 * A simplified version of the independent scraper worker designed specifically
 * for performance testing and throughput measurement.
 */

// Minimal worker state for performance testing
let perfTestState = {
  requestCount: 0,
  startTime: Date.now(),
  totalLatency: 0,
  successful: 0,
  failed: 0
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle different endpoints for testing
    if (request.method === 'GET' && url.pathname === '/status') {
      return handleStatus();
    }
    
    if (request.method === 'POST' && url.pathname === '/') {
      return handlePerfTest(request, env);
    }
    
    return new Response('Performance Test Worker Ready', { status: 200 });
  }
};

async function handleStatus() {
  const uptime = Date.now() - perfTestState.startTime;
  const avgLatency = perfTestState.requestCount > 0 ? 
    perfTestState.totalLatency / perfTestState.requestCount : 0;
  
  return new Response(JSON.stringify({
    status: 'operational',
    uptime_ms: uptime,
    total_requests: perfTestState.requestCount,
    successful_requests: perfTestState.successful,
    failed_requests: perfTestState.failed,
    avg_latency_ms: Math.round(avgLatency),
    requests_per_minute: perfTestState.requestCount / (uptime / 60000)
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handlePerfTest(request, env) {
  const requestStart = Date.now();
  perfTestState.requestCount++;
  
  try {
    const body = await request.json();
    const parcelIds = body.parcel_ids || [];
    const isTestMode = body.test_mode === true;
    
    if (parcelIds.length === 0) {
      perfTestState.failed++;
      return new Response(JSON.stringify({
        error: 'No parcel_ids provided',
        successful: 0,
        failed: parcelIds.length
      }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Simulate processing time (reduced for performance testing)
    const processingResults = await simulateProcessing(parcelIds, isTestMode);
    
    const requestEnd = Date.now();
    perfTestState.totalLatency += (requestEnd - requestStart);
    
    if (processingResults.successful > 0) {
      perfTestState.successful++;
    } else {
      perfTestState.failed++;
    }
    
    return new Response(JSON.stringify({
      successful: processingResults.successful,
      failed: processingResults.failed,
      processing_time_ms: requestEnd - requestStart,
      parcels_processed: processingResults.successful,
      worker_stats: {
        total_requests: perfTestState.requestCount,
        avg_latency_ms: Math.round(perfTestState.totalLatency / perfTestState.requestCount)
      }
    }), {
      headers: { 
        'Content-Type': 'application/json',
        'X-Worker-Performance': `${Math.round((requestEnd - requestStart))}ms`
      }
    });
    
  } catch (error) {
    perfTestState.failed++;
    
    return new Response(JSON.stringify({
      error: error.message,
      successful: 0,
      failed: 1
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function simulateProcessing(parcelIds, isTestMode = false) {
  // In test mode, use faster simulated processing
  if (isTestMode) {
    // Simulate 95% success rate with minimal delay
    const successful = Math.floor(parcelIds.length * 0.95);
    const failed = parcelIds.length - successful;
    
    // Very short delay to simulate network/processing time
    await sleep(Math.random() * 50 + 10); // 10-60ms
    
    return { successful, failed };
  }
  
  // For non-test mode, simulate more realistic processing
  const results = { successful: 0, failed: 0 };
  
  for (const parcelId of parcelIds) {
    try {
      // Simulate processing delay (much shorter than real scraping)
      await sleep(Math.random() * 100 + 50); // 50-150ms per parcel
      
      // Simulate 90% success rate
      if (Math.random() > 0.1) {
        results.successful++;
      } else {
        results.failed++;
      }
      
    } catch (error) {
      results.failed++;
    }
  }
  
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}