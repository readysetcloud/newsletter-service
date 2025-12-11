// Template and Snippet Types
export interface Template {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: 'template';
  snippets?: string[]; // Used snippets
  isVisualMode?: boolean;
  visualConfig?: any;
  s3Key: string;
  s3VersionId: string;
  content?: string; // Template content (loaded separately)
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  apiKeyId?: string;
  version: number;
  isActive: boolean;
}

export interface Snippet {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  type: 'snippet';
  parameters?: SnippetParameter[];
  s3Key: string;
  s3VersionId: string;
  content?: string; // Snippet content (loaded separately)
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  apiKeyId?: string;
  version: number;
  isActive: boolean;
}

export interface SnippetParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea' | 'url';
  required: boolean;
  defaultValue?: any;
  description?: string;
  options?: string[]; // For select type
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

// Request/Response Types
export interface CreateTemplateRequest {
  name: string;
  description?: string;
  content: string;
  isVisualMode?: boolean;
  visualConfig?: any;
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  content?: string;
  isVisualMode?: boolean;
  visualConfig?: any;
}

export interface CreateSnippetRequest {
  name: string;
  description?: string;
  content: string;
  parameters?: SnippetParameter[];
}

export interface UpdateSnippetRequest {
  name?: string;
  description?: string;
  content?: string;
  parameters?: SnippetParameter[];
}

export interface TemplateListResponse {
  templates: Template[];
  total: number;
}

export interface SnippetListResponse {
  snippets: Snippet[];
  total: number;
}

export interface PreviewTemplateRequest {
  testData?: Record<string, any>;
  sendTestEmail?: boolean;
  testEmailAddress?: string;
  emailCompatible?: boolean;
  clientId?: string;
}

export interface PreviewSnippetRequest {
  parameters?: Record<string, any>;
}

export interface PreviewResponse {
  html: string;
  success: boolean;
  error?: string;
  emailWarnings?: EmailWarning[];
  emailCompatible?: boolean;
  clientId?: string;
}

export interface EmailWarning {
  type: 'compatibility' | 'accessibility';
  severity: 'error' | 'warning' | 'info';
  message: string;
  count: number;
  examples?: string[];
}

// Filter and Search Types
export interface TemplateFilters {
  search?: string;
  createdBy?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface SnippetFilters {
  search?: string;
  createdBy?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

// Version Management Types
export interface TemplateVersion {
  versionId: string;
  lastModified: string;
  size: number;
  etag: string;
  isLatest: boolean;
}

export interface TemplateVersionsResponse {
  templateId: string;
  s3Key: string;
  versions: TemplateVersion[];
  totalVersions: number;
}

export interface TemplateVersionResponse {
  templateId: string;
  versionId: string;
  content: string;
  lastModified: string;
  size: number;
  etag: string;
  metadata: Record<string, string>;
}

export interface RestoreVersionResponse {
  templateId: string;
  restoredFromVersion: string;
  newVersionId: string;
  restoredAt: string;
  restoredBy?: string;
}

// Import/Export Types
export interface ExportTemplatesRequest {
  templateIds: string[];
  includeSnippets?: boolean;
  format?: 'zip' | 'json';
}

export interface ExportTemplatesResponse {
  format: 'zip' | 'json';
  filename: string;
  data: string | any;
  size?: number;
  templateCount: number;
  snippetCount: number;
}

export interface ImportTemplatesRequest {
  data: string | any;
  format?: 'zip' | 'json';
  conflictResolution?: 'skip' | 'overwrite' | 'rename';
  preserveIds?: boolean;
}

export interface ImportResult {
  id: string;
  name: string;
  originalId?: string;
}

export interface ImportError {
  type: 'template' | 'snippet';
  id: string;
  name: string;
  error: string;
}

export interface ImportTemplatesResponse {
  success: boolean;
  results: {
    imported: {
      templates: ImportResult[];
      snippets: ImportResult[];
    };
    skipped: {
      templates: ImportResult[];
      snippets: ImportResult[];
    };
    errors: ImportError[];
  };
  summary: {
    templatesImported: number;
    templatesSkipped: number;
    snippetsImported: number;
    snippetsSkipped: number;
    errors: number;
  };
}

export interface ExportOptions {
  includeSnippets?: boolean;
  format?: 'zip' | 'json';
}

export interface ImportOptions {
  format?: 'zip' | 'json';
  conflictResolution?: 'skip' | 'overwrite' | 'rename';
  preserveIds?: boolean;
}

// UI State Types
export interface TemplateListState {
  templates: Template[];
  loading: boolean;
  error?: string;
  filters: TemplateFilters;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

export interface SnippetListState {
  snippets: Snippet[];
  loading: boolean;
  error?: string;
  filters: SnippetFilters;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}
