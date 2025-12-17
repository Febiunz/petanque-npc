# Azure Function Deployment Guide

This guide explains how to deploy and configure the schedule updater Azure Function for production use.

## Prerequisites

- Azure subscription
- Azure CLI installed (for manual setup)
- Storage account (for Azure Functions runtime)
- Backend App Service already deployed

## Deployment Options

### Option A: Using GitHub Actions (Recommended)

The workflow at `.github/workflows/azure-deploy.yml` includes the function deployment.

1. **Create the Function App in Azure Portal:**
   ```bash
   # Using Azure CLI
   az functionapp create \
     --resource-group <your-resource-group> \
     --name npc-standen-function \
     --storage-account npcstandenstorageaccount \
     --consumption-plan-location westeurope \
     --runtime node \
     --runtime-version 22 \
     --functions-version 4 \
     --os-type Linux
   ```

2. **Get the Publish Profile:**
   - Go to Azure Portal → Function App → Overview
   - Click "Get publish profile"
   - Save the downloaded XML file content

3. **Add GitHub Secret:**
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - Add new secret: `AZURE_FUNCTION_PUBLISH_PROFILE`
   - Paste the publish profile content

4. **Deploy:**
   - Push to `main` branch, or
   - Manually trigger the workflow from Actions tab

### Option B: Manual Deployment

1. **Create Function App** (as shown above)

2. **Deploy using Azure CLI:**
   ```bash
   cd function
   npm ci --production
   func azure functionapp publish npc-standen-function
   ```

## Storage Configuration

### Shared File Mount (Recommended)

This approach allows both the backend and function to access the same `schedule.json` file.

1. **Create File Share:**
   ```bash
   az storage share create \
     --name npc-data \
     --account-name npcstandenstorageaccount
   ```

2. **Upload Initial Schedule:**
   - Upload your existing `backend/data/schedule.json` to the file share
   - You can do this via Azure Portal or Azure CLI

3. **Mount to Backend App Service:**
   ```bash
   az webapp config storage-account add \
     --resource-group <your-resource-group> \
     --name npc-standen-backend \
     --custom-id data \
     --storage-type AzureFiles \
     --share-name npc-data \
     --account-name npcstandenstorageaccount \
     --access-key "<storage-key>" \
     --mount-path /mnt/data
   ```

   Then configure the backend to use the mounted path:
   ```bash
   az webapp config appsettings set \
     --name npc-standen-backend \
     --resource-group <your-resource-group> \
     --settings SCHEDULE_DATA_DIR="/mnt/data"
   ```

4. **Mount to Function App:**
   ```bash
   az functionapp config storage-account add \
     --resource-group <your-resource-group> \
     --name npc-standen-function \
     --custom-id data \
     --storage-type AzureFiles \
     --share-name npc-data \
     --account-name npcstandenstorageaccount \
     --access-key "<storage-key>" \
     --mount-path /mnt/data
   ```

5. **Configure Function App Settings:**
   ```bash
   az functionapp config appsettings set \
     --name npc-standen-function \
     --resource-group <your-resource-group> \
     --settings SCHEDULE_FILE_PATH="/mnt/data/schedule.json"
   ```

6. **Update Backend** (if needed):
   - Modify `backend/storage/schedule.js` to use `/mnt/data/schedule.json` instead of relative path
   - Or set an environment variable in the App Service

### Alternative: Azure Blob Storage

If you prefer blob storage (requires backend migration):

1. **Update Function Code:**
   - Edit `function/schedule-updater/index.js`
   - Change `import { readSchedule, updateSchedule } from '../lib/storageSimple.js';`
   - To `import { readSchedule, updateSchedule } from '../lib/storage.js';`

2. **Configure Function App:**
   ```bash
   az functionapp config appsettings set \
     --name npc-standen-function \
     --resource-group <your-resource-group> \
     --settings \
       AZURE_STORAGE_CONNECTION_STRING="<connection-string>" \
       STORAGE_CONTAINER_NAME="data"
   ```

3. **Migrate Backend:**
   - Update backend to use Azure Blob Storage instead of file system
   - Upload existing data files to blob storage

## Verification

### Check Function Status

1. **Azure Portal:**
   - Navigate to Function App → Functions → schedule-updater
   - Check "Function Keys" to ensure it's enabled
   - View "Monitor" for execution history

2. **Test Manual Trigger:**
   ```bash
   # Get the function URL
   az functionapp function show \
     --name npc-standen-function \
     --resource-group <your-resource-group> \
     --function-name schedule-updater
   
   # Or trigger from Portal: Function → Code + Test → Run
   ```

### Monitor Execution

- **Application Insights** (if configured):
  - View detailed logs and telemetry
  - Set up alerts for failures
  
- **Function Logs:**
  - Portal → Function → Monitor
  - View invocation history
  - Check for errors or warnings

### Verify Schedule Updates

After the function runs:

1. Check the function logs for messages like:
   ```
   Found 2 match(es) with changed dates
   Updated match 100102: 2025-09-20 -> 2025-09-27
   ```

2. Verify the backend API returns updated dates:
   ```bash
   curl https://<your-backend>.azurewebsites.net/api/matches/schedule
   ```

3. Check the mounted file or blob storage directly

## Troubleshooting

### Function Not Triggering

- **Check CRON Expression:** The timer is set for 20:00 UTC Monday
  - This is 21:00 CET (winter) or 22:00 CEST (summer)
  - Modify `function/schedule-updater/function.json` if needed

- **Verify Function is Running:**
  ```bash
  az functionapp show \
    --name npc-standen-function \
    --resource-group <your-resource-group> \
    --query state
  ```

### File Access Errors

- **Check Mount Path:**
  - Verify mount was successful: Portal → Configuration → Path mappings
  - Test file access from Kudu console: `https://<function-app>.scm.azurewebsites.net`

- **Verify Permissions:**
  - Ensure storage account key is correct
  - Check file share permissions

### Parser Errors

- **Website Structure Changed:**
  - Check function logs for parsing errors
  - The official website HTML structure may have changed
  - Update `function/lib/scheduleParser.js` if needed

- **Test Locally:**
  ```bash
  cd function
  npm install
  npm test
  ```

### No Updates Detected

- Verify the official website has matches with "Aangepaste datum" values
- Check function logs to see if HTML was fetched successfully
- The function only updates matches where the changed date differs from the round default

## Monitoring and Alerts

### Set Up Alerts

1. **Create Action Group** (for notifications):
   ```bash
   az monitor action-group create \
     --name schedule-updater-alerts \
     --resource-group <your-resource-group> \
     --short-name schedalert \
     --email admin admin@example.com
   ```

2. **Create Alert Rule** (for failures):
   ```bash
   az monitor metrics alert create \
     --name schedule-updater-failure \
     --resource-group <your-resource-group> \
     --scopes /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Web/sites/npc-standen-function \
     --condition "count FailedRequests > 0" \
     --description "Alert when schedule updater function fails" \
     --action schedule-updater-alerts
   ```

### Regular Checks

- Review function execution logs weekly
- Verify schedule updates are being applied
- Monitor Application Insights for performance issues

## Cost Optimization

- **Consumption Plan:** Pay only for executions (very low cost for weekly runs)
- **Shared Storage:** Use same storage account for function runtime and data
- **Application Insights:** Consider data retention policies

## Updating the Function

To deploy code changes:

1. **Via GitHub Actions:**
   - Push changes to `main` branch
   - Workflow will automatically deploy

2. **Via Azure CLI:**
   ```bash
   cd function
   func azure functionapp publish npc-standen-function
   ```

## Security Best Practices

- Store connection strings in Azure Key Vault
- Use managed identity where possible
- Limit CORS and network access
- Enable HTTPS only
- Regularly update Node.js runtime version

## Support

For issues or questions:
- Check function logs first
- Review this guide and main README.md
- Open an issue in the GitHub repository
