export interface User {
    id: string;
    name: string;
    isConnected?: boolean; // Track connection status for rejoin logic
}
