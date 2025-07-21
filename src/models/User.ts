export interface User {
    id: string;
    name: string;
    // isLeader: boolean;
    // ready: boolean;
    webhookUrl: string; // Mandatory webhook for user
}
