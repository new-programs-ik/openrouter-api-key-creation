// Vercel entry point. vercel.json routes every path here; the routes are in lib/webApp.js.
// Hosted mode: Google sign-in is required and keys are saved to private Vercel Blob storage.
const { createWebHandler } = require('../lib/webApp');

module.exports = createWebHandler({ hosted: true });
