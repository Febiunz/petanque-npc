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

### Azure Blob Storage (Configured)

Both the backend and function now use Azure Blob Storage (`npcstandenstorageaccount`) for the schedule.json file. This provides:
- ✅ Shared storage between backend and function
- ✅ No file mounts needed
- ✅ Better for serverless architecture
- ✅ Automatic scalability

**Setup Steps:**

1. **Get Storage Connection String:**
   ```bash
   az storage account show-connection-string \
     --name npcstandenstorageaccount \
     --resource-group <your-resource-group> \
     --output tsv
   ```

2. **Create Blob Container:**
   ```bash
   az storage container create \
     --name data \
     --account-name npcstandenstorageaccount \
     --connection-string "<connection-string>"
   ```

3. **Configure Backend App Service:**
   ```bash
   az webapp config appsettings set \
     --name npc-standen-backend \
     --resource-group <your-resource-group> \
     --settings AZURE_STORAGE_CONNECTION_STRING="<connection-string>" \
                STORAGE_CONTAINER_NAME="data"
   ```

4. **Configure Function App:**
   ```bash
   az functionapp config appsettings set \
     --name npc-standen-function \
     --resource-group <your-resource-group> \
     --settings AZURE_STORAGE_CONNECTION_STRING="<connection-string>" \
                STORAGE_CONTAINER_NAME="data"
   ```

5. **Initial Schedule Upload (Optional):**
   If you have an existing schedule.json, upload it:
   ```bash
   az storage blob upload \
     --account-name npcstandenstorageaccount \
     --container-name data \
     --name schedule.json \
     --file backend/data/schedule.json \
     --connection-string "<connection-string>"
   ```

   Otherwise, the backend will automatically create it on first run.

### Alternative: File-Based Storage (Local Development)

For local development without Azure Storage:
- Backend uses `backend/data/schedule.json` (default)
- Function needs to be configured to use `storageSimple.js` instead of `storage.js`
- No AZURE_STORAGE_CONNECTION_STRING needed

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
