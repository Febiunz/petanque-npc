# Schedule Updater Azure Function

This Azure Function automatically checks the official petanque website weekly for changed match dates and updates the schedule accordingly.

## Overview

- **Trigger**: Timer-based, runs every Monday at 20:00 UTC
- **Purpose**: Detect matches with changed playing dates (via "Aangepaste datum" column) and update `schedule.json`
- **Source**: https://nlpetanque.nl/topdivisie-2025-2026-1001/
- **Storage**: Azure Blob Storage (`npcstandenstorageaccount`)

## How It Works

1. Every Monday evening at 20:00 UTC, the function is triggered
2. It fetches the official schedule HTML from the website
3. It parses the HTML looking for the "Aangepaste datum" (changed date) column
4. For any matches with changed dates, it updates the corresponding entries in `schedule.json`
5. The updated schedule is saved to Azure Blob Storage

## Storage Configuration

The function uses **Azure Blob Storage** for shared access with the backend:

- **Storage Account**: `npcstandenstorageaccount`
- **Container**: `data`
- **File**: `schedule.json`

### Environment Variables

Required for production:
- `AZURE_STORAGE_CONNECTION_STRING`: Connection string for Azure Storage account
- `STORAGE_CONTAINER_NAME`: Name of the blob container (default: "data")
- `FUNCTIONS_WORKER_RUNTIME`: Set to "node"
- `AzureWebJobsStorage`: Storage connection for Azure Functions runtime

For local development (no Azure Storage):
- Function will use local file path fallback

## Local Development

1. Install dependencies:
   ```bash
   cd function
   npm install
   ```

2. Copy the template settings file:
   ```bash
   cp local.settings.json.template local.settings.json
   ```

3. Edit `local.settings.json` and configure:
   - For local development with file mount: Set `SCHEDULE_FILE_PATH` to point to `../backend/data/schedule.json`
   - For Azure Blob Storage testing: Add your connection string

4. Run the function locally:
   ```bash
   npm start
   ```

5. To trigger the function manually (without waiting for the timer):
   - Use the Azure Functions Core Tools admin endpoint
   - Or modify the schedule temporarily for testing

## Deployment

The function is deployed to Azure Functions using the GitHub Actions workflow at `.github/workflows/azure-deploy.yml`.

### Required Azure Resources

- **Azure Functions App**: Linux-based, Node.js 22 runtime
- **Azure Storage Account**: For function runtime (required for all Azure Functions)
- **File Share or Blob Storage**: Depending on your chosen storage option
- **Application Insights** (optional): For monitoring and logging

### Configuration in Azure Portal

After deployment, configure these Application Settings in the Function App:

**For Shared File Mount approach:**
- `SCHEDULE_FILE_PATH`: Path to the mounted schedule.json file (e.g., `/mnt/data/schedule.json`)
- Mount a file share that the backend also uses

**For Azure Blob Storage approach:**
- `AZURE_STORAGE_CONNECTION_STRING`: Your storage account connection string
- `STORAGE_CONTAINER_NAME`: "data" (or your chosen container name)
- Update `index.js` to import from `storage.js` instead of `storageSimple.js`

## Using Shared File Mount (Recommended)

The simplest way to set this up with the current architecture:

1. **Create an Azure File Share** in your storage account
2. **Upload** the existing `backend/data/schedule.json` to the file share
3. **Mount the file share** to both:
   - Your Azure App Service (backend): Configure via Portal → Configuration → Path mappings
   - Your Azure Function App: Configure via Portal → Configuration → Path mappings
4. **Update both apps** to use the mounted path (e.g., `/mnt/data/schedule.json`)
5. Set `SCHEDULE_FILE_PATH=/mnt/data/schedule.json` in Function App settings

This approach requires no code changes to the backend and maintains the existing file-based architecture.

## Monitoring

View function execution logs in:
- Azure Portal → Function App → Functions → schedule-updater → Monitor
- Application Insights (if configured)

The function logs:
- Number of changed dates found
- Each match update (old date → new date)
- Any errors encountered

## Testing

To test the function:

1. **Manual Trigger**: Use the Azure Portal or Azure Functions Core Tools to trigger manually
2. **View Logs**: Check execution logs for parsed changes
3. **Verify Storage**: Confirm `schedule.json` was updated (check file share or blob storage)
4. **Check Backend**: Verify the backend API returns updated dates

## Troubleshooting

- **No updates found**: Check if the official website structure has changed
- **Storage errors**: Verify file path or connection string configuration
- **Parse errors**: Website HTML structure may have changed; update parser logic in `scheduleParser.js`
- **Timezone issues**: Timer uses UTC; current setting is 20:00 UTC which is 21:00/22:00 CET depending on DST
- **File access errors**: Ensure the file share is properly mounted with read/write permissions

## Future Improvements

- Add email notifications when matches are updated
- Support for multiple seasons/competitions
- Detect postponed/canceled matches (not just date changes)
- Add unit tests for the parser
