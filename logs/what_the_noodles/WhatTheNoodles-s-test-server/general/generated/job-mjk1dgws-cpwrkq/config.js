// Placeholder token – replace with real token during build or runtime
export const API_TOKEN = 'YOUR_PTERODACTYL_API_TOKEN';

// Replace with actual server UUID
export const SERVER_UUID = 'YOUR_SERVER_UUID';

export const API_BASE_URL = (serverUuid) => `/api/client/servers/${serverUuid}/command`;
