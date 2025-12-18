/**
 * Main application entry point for Azure Functions
 * This file explicitly imports all function registrations
 * to ensure they are discovered by the Azure Functions runtime.
 */

import { app } from '@azure/functions';

// Import function registrations (this registers them with the app object)
import './functions/scheduleUpdater.js';

// The functions are registered via app.timer() calls in their respective files
// Export app so the Azure Functions runtime can discover registered functions
export { app };
