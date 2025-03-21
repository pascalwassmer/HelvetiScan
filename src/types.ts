export interface Article {
  article: string;
  views: number;
  growth?: number;
  growthPercentage?: number;
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