# Schedule Updater Azure Function

This Azure Function automatically checks the official petanque website weekly for changed match dates and updates the schedule accordingly.

## Overview

- **Trigger**: Timer-based, runs every Monday at 20:00 CET
- **Purpose**: Detect matches with changed playing dates (via "Aangepaste datum" column) and update `schedule.json`
- **Source**: https://nlpetanque.nl/topdivisie-2025-2026-1001/

## How It Works

1. Every Monday evening at 20:00, the function is triggered
2. It fetches the official schedule HTML from the website
3. It parses the HTML looking for the "Aangepaste datum" (changed date) column
4. For any matches with changed dates, it updates the corresponding entries in `schedule.json`
5. The updated schedule is saved back to Azure Storage

## Storage Requirements

The function requires access to Azure Blob Storage where `schedule.json` is stored. Both the backend API and this function should use the same storage account/container.

### Environment Variables

- `AZURE_STORAGE_CONNECTION_STRING`: Connection string for Azure Storage account
- `STORAGE_CONTAINER_NAME`: Name of the blob container (default: "data")
- `FUNCTIONS_WORKER_RUNTIME`: Set to "node"
- `AzureWebJobsStorage`: Storage connection for Azure Functions runtime

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the template settings file:
   ```bash
   cp local.settings.json.template local.settings.json
   ```

3. Edit `local.settings.json` and add your Azure Storage connection string

4. Run the function locally:
   ```bash
   npm start
   ```

5. To trigger the function manually (without waiting for the timer):
   - Use the Azure Functions Core Tools admin endpoint
   - Or modify the schedule temporarily for testing

## Deployment

The function should be deployed to Azure Functions using the GitHub Actions workflow. The workflow should:

1. Build the function app
2. Deploy to Azure Functions
3. Configure application settings with the required environment variables

### Required Azure Resources

- **Azure Functions App**: Linux-based, Node.js runtime
- **Azure Storage Account**: For both function runtime and schedule.json storage
- **Application Insights** (optional): For monitoring and logging

### Configuration in Azure Portal

After deployment, configure these Application Settings:

- `AZURE_STORAGE_CONNECTION_STRING`: Your storage account connection string
- `STORAGE_CONTAINER_NAME`: "data" (or your chosen container name)

## Migration Notes

### Transitioning from File-Based to Azure Storage

The current backend stores `schedule.json` locally in `backend/data/`. To use this function:

1. Upload the existing `schedule.json` to Azure Blob Storage
2. Update the backend to read from Azure Storage instead of local filesystem
3. Ensure both the backend and function use the same storage account/container

Alternatively, for a simpler initial implementation, you could modify the function to use a shared file mount or have it call the backend API to update the schedule.

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
3. **Verify Storage**: Confirm `schedule.json` was updated in blob storage
4. **Check Backend**: Verify the backend API returns updated dates

## Troubleshooting

- **No updates found**: Check if the official website structure has changed
- **Storage errors**: Verify connection string and container name
- **Parse errors**: Website HTML structure may have changed; update parser logic
- **Timezone issues**: Timer uses UTC; adjust CRON expression if needed for CET/CEST

## Future Improvements

- Add email notifications when matches are updated
- Support for multiple seasons/competitions
- Detect postponed/canceled matches (not just date changes)
- Add unit tests for the parser
