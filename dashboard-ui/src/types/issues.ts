export type IssueStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export interface IssueListItem {
  id: string;
  issueNumber: number;
  title: string;
  slug: string;
  status: IssueStatus;
  createdAt: string;
  publishedAt?: string;
  scheduledAt?: string;
}

export interface IssueStats {
  opens: number;
  clicks: number;
  deliveries: number;
  bounces: number;
  complaints: number;
}

export interface Issue extends IssueListItem {
  content: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  stats?: IssueStats;
}

export interface TopPerformer {
  id: string;
  title: string;
  openRate: number;
  clickRate: number;
}

export interface TrendsData {
  totalIssues: number;
  publishedCount: number;
  avgOpenRate: number;
  avgClickRate: number;
  topPerformers: TopPerformer[];
}

export interface CreateIssueRequest {
  title: string;
  content: string;
  slug: string;
  scheduledAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateIssueRequest {
  title?: string;
  content?: string;
  slug?: string;
  scheduledAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ListIssuesParams {
  limit?: number;
  nextToken?: string;
  status?: IssueStatus;
}
