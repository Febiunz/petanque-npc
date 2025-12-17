import { BlobServiceClient } from '@azure/storage-blob';

/**
 * Azure Blob Storage helper for all data files
 * Both the backend and Azure Function use this to access shared data
 * Supports: schedule.json, teams.json, matches.json
 */

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.STORAGE_CONTAINER_NAME || 'data';

let blobServiceClient = null;

function getBlobServiceClient() {
  if (!connectionString) {
    throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable not set');
  }
  if (!blobServiceClient) {
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  }
  return blobServiceClient;
}

export async function readBlobFile(fileName) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(fileName);

  try {
    const downloadResponse = await blobClient.download();
    const downloaded = await streamToBuffer(downloadResponse.readableStreamBody);
    return JSON.parse(downloaded.toString());
  } catch (err) {
    if (err.statusCode === 404) {
      throw new Error(`${fileName} not found in Azure Blob Storage`);
    }
    throw err;
  }
}

export async function writeBlobFile(fileName, data) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(containerName);
  
  // Ensure container exists
  await containerClient.createIfNotExists();
  
  const blobClient = containerClient.getBlockBlobClient(fileName);
  const content = JSON.stringify(data, null, 2);
  
  await blobClient.upload(content, Buffer.byteLength(content), {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

export async function deleteBlobFile(fileName) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(fileName);
  
  try {
    await blobClient.delete();
  } catch (err) {
    if (err.statusCode !== 404) {
      throw err;
    }
    // Ignore 404 errors (file doesn't exist)
  }
}

export async function blobExists(fileName) {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(fileName);
  
  try {
    await blobClient.getProperties();
    return true;
  } catch (err) {
    if (err.statusCode === 404) {
      return false;
    }
    throw err;
  }
}

// Legacy functions for backward compatibility
export async function readScheduleFromBlob() {
  return readBlobFile('schedule.json');
}

export async function writeScheduleToBlob(schedule) {
  return writeBlobFile('schedule.json', schedule);
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
