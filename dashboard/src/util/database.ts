// Database service for reading SQLite data
// Since we're in a frontend app, we'll need to call a server endpoint
// that can access the SQLite database

export interface OwnerData {
  id: number;
  parcel_id: string;
  owner_name: string | null;
  property_address: string | null;
  total_acreage: string | null;
  property_type: string | null;
  market_value: string | null;
  market_value_year: string | null;
  scraped_at: string;
  last_updated: string;
  scrape_status: string;
  worker_id: string | null;
  retry_count: number;
}

export interface WorkQueueItem {
  id: number;
  parcel_id: string;
  status: string;
  assigned_worker: string | null;
  attempts: number;
  last_attempt: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerStatus {
  worker_id: string;
  status: string;
  last_seen: string | null;
  parcels_processed: number;
  parcels_failed: number;
  average_time_per_parcel: number;
  created_at: string;
  updated_at: string;
}

export interface ScrapingProgress {
  total_parcels: number;
  completed: number;
  pending: number;
  in_progress: number;
  failed: number;
  completion_percentage: number;
}

const BASE_URL = 'http://localhost:3000'; // Database API server port

// Fetch owner data with pagination and filtering
export async function fetchOwnerData(
  page: number = 1,
  limit: number = 50,
  searchTerm?: string
): Promise<{ data: OwnerData[]; total: number; page: number; totalPages: number }> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  
  if (searchTerm) {
    params.set('search', searchTerm);
  }
  
  const response = await fetch(`${BASE_URL}/api/owner-data?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch owner data: ${response.statusText}`);
  }
  return response.json();
}

// Fetch work queue data
export async function fetchWorkQueue(
  page: number = 1,
  limit: number = 50,
  status?: string
): Promise<{ data: WorkQueueItem[]; total: number; page: number; totalPages: number }> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  
  if (status) {
    params.set('status', status);
  }
  
  const response = await fetch(`${BASE_URL}/api/work-queue?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch work queue: ${response.statusText}`);
  }
  return response.json();
}

// Fetch worker status data
export async function fetchWorkerStatus(): Promise<WorkerStatus[]> {
  const response = await fetch(`${BASE_URL}/api/worker-status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch worker status: ${response.statusText}`);
  }
  return response.json();
}

// Fetch scraping progress
export async function fetchScrapingProgress(): Promise<ScrapingProgress> {
  const response = await fetch(`${BASE_URL}/api/scraping-progress`);
  if (!response.ok) {
    throw new Error(`Failed to fetch scraping progress: ${response.statusText}`);
  }
  return response.json();
}