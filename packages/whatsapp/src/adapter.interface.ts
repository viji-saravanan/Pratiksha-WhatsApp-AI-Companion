import type { ExternalCallResult } from "@viji/shared";

export interface WhatsAppDoctorOptions {
  connect?: boolean;
}

export interface WhatsAppAuthOptions {
  downloadMedia?: boolean;
  follow?: boolean;
  idleExit?: string;
}

export interface WhatsAppSyncOptions extends WhatsAppAuthOptions {
  once?: boolean;
  refreshContacts?: boolean;
  refreshGroups?: boolean;
}

export interface WhatsAppListMessagesOptions {
  chatId?: string;
  limit?: number;
  after?: string;
  before?: string;
}

export interface WhatsAppSearchMessagesOptions extends WhatsAppListMessagesOptions {
  query: string;
  from?: string;
  type?: "image" | "video" | "audio" | "document";
}

export interface WhatsAppListChatsOptions {
  limit?: number;
  query?: string;
}

export interface WhatsAppSendTextOptions {
  to: string;
  message: string;
}

export interface WhatsAppSendFileOptions {
  to: string;
  filePath: string;
  caption?: string;
  filename?: string;
  mime?: string;
}

export interface WhatsAppDownloadMediaOptions {
  chatId: string;
  messageId: string;
  output?: string;
}

export interface WhatsAppMarkReadOptions {
  chatId: string;
  messageIds: string[];
  senderId?: string;
  timestamp?: Date;
}

export interface WhatsAppAdapter {
  doctor(options?: WhatsAppDoctorOptions): Promise<ExternalCallResult<unknown>>;
  authStatus(): Promise<ExternalCallResult<unknown>>;
  auth(options?: WhatsAppAuthOptions): Promise<ExternalCallResult<unknown>>;
  sync(options?: WhatsAppSyncOptions): Promise<ExternalCallResult<unknown>>;
  listChats(options?: WhatsAppListChatsOptions): Promise<ExternalCallResult<unknown>>;
  listMessages(
    options?: WhatsAppListMessagesOptions
  ): Promise<ExternalCallResult<unknown>>;
  searchMessages(
    options: WhatsAppSearchMessagesOptions
  ): Promise<ExternalCallResult<unknown>>;
  sendText(options: WhatsAppSendTextOptions): Promise<ExternalCallResult<unknown>>;
  sendFile(options: WhatsAppSendFileOptions): Promise<ExternalCallResult<unknown>>;
  downloadMedia(
    options: WhatsAppDownloadMediaOptions
  ): Promise<ExternalCallResult<unknown>>;
  markRead?(options: WhatsAppMarkReadOptions): Promise<ExternalCallResult<unknown>>;
}
