const HOST = import.meta.env.VITE_BACKEND_HOST || 'localhost';

export const BACKEND_URL = `http://${HOST}:5000`;
export const BACKEND_WS_URL = `ws://${HOST}:5000`;
export const WS_URL = `${BACKEND_WS_URL}/terminal`;