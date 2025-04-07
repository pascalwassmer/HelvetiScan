export interface Article {
  article: string;
  views: number;
  growth?: number;
  growthPercentage?: number;
  previousViews?: number;
  reliability?: 'low' | 'medium' | 'high';
  metadata?: {
    description?: string;
    thumbnail?: string;
    categories?: string[];
    extract?: string;
  };
  languages?: Record<string, number>;
  mainLanguage?: string;
  dailyViews?: number[];
}

export type Period = 'daily' | '48h' | 'weekly' | 'monthly';
export type Language = 'fr' | 'en' | 'de' | 'es';
export type Tab = 'mostViewed' | 'trending';

export interface ApiResponse {
  items: {
    articles: Article[];
  }[];
}

export interface WikipediaCategory {
  title: string;
  pageId?: number;
  ns?: number;
}

export interface ThumbnailInfo {
  source: string;
  width?: number;
  height?: number;
}

export interface MediaWikiResponse {
  query: {
    pages: {
      pageid?: number;
      ns?: number;
      title: string;
      description?: string;
      thumbnail?: ThumbnailInfo;
      categories?: WikipediaCategory[];
      extract?: string;
    }[];
  };
}

export interface ViewHistory {
  date: string;
  views: number;
}
