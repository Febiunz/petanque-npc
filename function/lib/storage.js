import { BlobServiceClient } from '@azure/storage-blob';

/**
 * Azure Storage helper for reading and updating schedule.json and matches.json
 * These files should be stored in Azure Blob Storage
 * so that both the backend API and the Azure Function can access them.
 */

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.STORAGE_CONTAINER_NAME || 'data';
const scheduleFileName = 'schedule.json';
const matchesFileName = 'matches.json';

export async function readSchedule() {
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable not set');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(scheduleFileName);

  try {
    const downloadResponse = await blobClient.download();
    const downloaded = await streamToBuffer(downloadResponse.readableStreamBody);
    return JSON.parse(downloaded.toString());
  } catch (err) {
    if (err.statusCode === 404) {
      throw new Error('schedule.json not found in Azure Storage');
    }
    throw err;
  }
}

export async function updateSchedule(schedule) {
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable not set');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlockBlobClient(scheduleFileName);

  const content = JSON.stringify(schedule, null, 2);
  await blobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

async function streamToBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    readableStream.on('error', reject);
  });
}

/**
 * Read matches from Azure Blob Storage
 * Returns both the matches array and the ETag for optimistic concurrency control
 */
export async function readMatches() {
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable not set');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(matchesFileName);

  try {
    const downloadResponse = await blobClient.download();
    const downloaded = await streamToBuffer(downloadResponse.readableStreamBody);
    const matches = JSON.parse(downloaded.toString());
    // Return both matches and ETag for optimistic concurrency
    return { matches, etag: downloadResponse.etag };
  } catch (err) {
    if (err.statusCode === 404) {
      // matches.json doesn't exist yet, return empty array with no etag
      return { matches: [], etag: null };
    }
    throw err;
  }
}

/**
 * Update matches in Azure Blob Storage with optimistic concurrency control
 * Uses ETag to ensure no concurrent modifications occurred since the read
 */
export async function updateMatches(matches, etag = null) {
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable not set');
  }

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);
  const blobClient = containerClient.getBlockBlobClient(matchesFileName);

  const content = JSON.stringify(matches, null, 2);
  const uploadOptions = {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  };
  
  // Use ETag for optimistic concurrency control if provided
  if (etag) {
    uploadOptions.conditions = { ifMatch: etag };
  }
  
  try {
    await blobClient.upload(content, Buffer.byteLength(content), uploadOptions);
  } catch (err) {
    // If ETag mismatch, throw a more specific error
    if (err.statusCode === 412) {
      throw new Error('Concurrent modification detected: matches.json was modified by another process');
    }
    throw err;
  }
}
