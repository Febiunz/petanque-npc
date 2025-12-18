/**
 * Main application entry point for Azure Functions
 * This file explicitly imports all function registrations
 * to ensure they are discovered by the Azure Functions runtime.
 */

// Import function registrations (this registers them with the app object)
import './functions/scheduleUpdater.js';

// The functions are registered via app.timer() calls in their respective files
// No need to export anything - the @azure/functions app object handles registration
