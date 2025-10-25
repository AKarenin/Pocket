export interface Share {
  id: string;
  path: string;
  passcode: string;
  port: number;
  status: 'active' | 'inactive';
  createdAt: Date;
  lastAccessed?: Date;
  url?: string;
  name?: string;
  active?: boolean;
}

export interface ShareConfig {
  shares: Share[];
  cloudflareConfig: {
    tunnelId: string;
    domain: string;
    configPath: string;
  };
}

export interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  modified: Date;
}

export interface WebSocketMessage {
  type: 'file_changed' | 'file_added' | 'file_removed' | 'directory_updated';
  data: {
    path: string;
    item?: FileItem;
    items?: FileItem[];
  };
}

export interface TunnelStatus {
  isRunning: boolean;
  error?: string;
}

export interface CreateShareResult {
  shareId: string;
  passcode: string;
}

export interface MessageShareOptions {
  to?: string | string[];
  from?: string;
  expiresIn?: number | string;
  deleteOnRead?: boolean;
  metadata?: Record<string, unknown>;
  prefix?: string;
}

export interface SendMessagePayload<T = unknown> extends MessageShareOptions {
  content: T;
}

export interface MessageShareRecord<T = unknown> {
  id: string;
  payload: T;
  createdAt: string;
  expiresAt: string;
  deleteOnRead: boolean;
  from?: string;
  recipients: string[];
  metadata?: Record<string, unknown>;
  lastAccessed?: string;
}

export interface SendMessageResult {
  shareId: string;
  expiresAt: string;
  recipients: string[];
  from?: string;
  metadata?: Record<string, unknown>;
}

export type InboxMessage<T = unknown> = MessageShareRecord<T>;
