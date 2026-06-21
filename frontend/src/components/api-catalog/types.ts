export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'WS';

export interface ApiParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
  location: 'path' | 'query' | 'header' | 'body';
}

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  description: string;
  auth?: 'Required' | 'Optional' | 'Admin';
  parameters?: ApiParameter[];
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  exampleRequest?: string;
  exampleResponse?: string;
}

export interface ApiGroup {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  endpoints: ApiEndpoint[];
}

export interface WebSocketStage {
  id: string;
  name: string;
  description: string;
  icon: string;
  duration: string;
  status: 'idle' | 'active' | 'completed';
}

export interface CatalogStats {
  httpEndpoints: number;
  webSocketCount: number;
  backgroundJobs: number;
  uptime: number;
}
