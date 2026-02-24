import { Article, Language, Period, ApiResponse, MediaWikiResponse } from './types';
import { format, subDays } from 'date-fns';

const API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews";
const USER_AGENT = "HelvetiScan/1.0 (educational project)";

// Cache borné en mémoire (max 100 entrées)
const MAX_CACHE_SIZE = 100;
const cache: Map<string, { data: unknown; timestamp: number }> = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Récupère les données depuis l'API avec cache et retry
 */
async function fetchFromAPI<T = unknown>(url: string): Promise<T> {
  const now = Date.now();

  // Vérifier le cache
  const cached = cache.get(url);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data as T;
  }

  // Logique de retry avec backoff exponentiel
  let retries = 3;
  let delay = 1000;
  let lastError: unknown;

  while (retries > 0) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT }
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText} (${response.status})`);
      }

      const data = await response.json();

      // Borner la taille du cache
      if (cache.size >= MAX_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) cache.delete(oldestKey);
      }
      cache.set(url, { data, timestamp: now });

      return data as T;
    } catch (error) {
      console.error(`Attempt failed for ${url}:`, error);
      lastError = error;
      retries--;

      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  throw lastError;
}

/**
 * Filtre les pages non désirées comme les pages spéciales, discussions, etc.
 */
function filterUnwantedPages(articles: Article[]): Article[] {
  const unwantedPrefixes = [
    'Wikipédia:', 'Wikipedia:', 'Special:', 'Spécial:',
    'Speciale:', 'Spezial:', 'MediaWiki:', 'Help:', 'Aide:',
    'Hilfe:', 'Ayuda:', 'Template:', 'Modèle:', 'Vorlage:',
    'Plantilla:', 'User:', 'Utilisateur:', 'Benutzer:',
    'Usuario:', 'Talk:', 'Discussion:', 'Diskussion:', 'Discusión:'
  ];

  const unwantedPages = new Set([
    'Wikipédia:Accueil_principal', 'Wikipedia:Main_Page',
    'Wikipedia:Hauptseite', 'Wikipedia:Portada',
    'Cookie_(informatique)', 'HTTP_cookie', 'Cookie',
    'Recherche', 'Search', 'Suche', 'Búsqueda'
  ]);

  return articles.filter(article => {
    const decodedTitle = decodeURIComponent(article.article);
    return !unwantedPrefixes.some(prefix => decodedTitle.startsWith(prefix)) &&
           !unwantedPages.has(decodedTitle);
  });
}

/**
 * Calcule le nombre de jours à récupérer selon la période.
 * Note : l'API /top ne retourne que les données pour un jour donné.
 * Pour les périodes > daily, on récupère le jour le plus récent.
 */
function getDaysToSubtract(period: Period): number {
  switch (period) {
    case '48h': return 1;
    case 'weekly': return 1;
    case 'monthly': return 1;
    case 'daily':
    default: return 1;
  }
}

/**
 * Récupère les articles les plus consultés
 */
export async function fetchTopArticles(language: Language, period: Period, swissOnly: boolean): Promise<Article[]> {
  const date = new Date();
  const formattedDate = format(subDays(date, getDaysToSubtract(period)), 'yyyyMMdd');
  const project = `${language}.wikipedia`;

  const url = `${API_BASE}/top/${project}/all-access/${formattedDate.slice(0, 4)}/${formattedDate.slice(4, 6)}/${formattedDate.slice(6, 8)}`;

  const data = await fetchFromAPI<ApiResponse>(url);
  let articles = data.items[0].articles;

  articles = filterUnwantedPages(articles);

  if (swissOnly) {
    articles = await filterSwissArticlesV2(articles, language);
  }

  if (articles.length > 0) {
    const enrichedArticles = await enrichArticlesWithMetadata(articles, language);
    return enrichedArticles.slice(0, 50);
  }

  return articles.slice(0, 50);
}

/**
 * Récupère les articles en progression
 */
export async function fetchTrendingArticles(language: Language, period: Period, swissOnly: boolean): Promise<Article[]> {
  const currentData = await fetchTopArticles(language, period, false);
  const previousData = await fetchPreviousPeriodData(language, period);

  let trendingArticles = calculateTrendsImproved(currentData, previousData);

  if (swissOnly) {
    trendingArticles = await filterSwissArticlesV2(trendingArticles, language);
  }

  return trendingArticles.slice(0, 50);
}

/**
 * Récupère les données de la période précédente pour calcul de tendances
 */
async function fetchPreviousPeriodData(language: Language, period: Period): Promise<Article[]> {
  const date = new Date();
  let daysToSubtract = 2; // Default for daily

  switch (period) {
    case '48h':
      daysToSubtract = 3;
      break;
    case 'weekly':
      daysToSubtract = 8;
      break;
    case 'monthly':
      daysToSubtract = 31;
      break;
  }

  const formattedDate = format(subDays(date, daysToSubtract), 'yyyyMMdd');
  const project = `${language}.wikipedia`;
  const url = `${API_BASE}/top/${project}/all-access/${formattedDate.slice(0, 4)}/${formattedDate.slice(4, 6)}/${formattedDate.slice(6, 8)}`;

  const data = await fetchFromAPI<ApiResponse>(url);
  let articles = data.items[0].articles;
  articles = filterUnwantedPages(articles);
  return articles;
}

/**
 * Calcul amélioré des tendances avec fiabilité — utilise Map pour O(n)
 */
function calculateTrendsImproved(currentArticles: Article[], previousArticles: Article[]): Article[] {
  // Indexer les articles précédents par titre pour lookup O(1)
  const previousMap = new Map(previousArticles.map(a => [a.article, a]));

  const trends = currentArticles.map(current => {
    const previous = previousMap.get(current.article);
    const previousViews = previous?.views || 0;

    if (previousViews < 100) {
      return {
        ...current,
        growth: 0,
        growthPercentage: 0,
        previousViews,
        reliability: 'low' as const
      };
    }

    const growth = current.views - previousViews;
    const growthPercentage = (growth / previousViews) * 100;

    const reliability: 'low' | 'medium' | 'high' =
      current.views > 10000 && previousViews > 1000 ? 'high' : 'medium';

    return {
      ...current,
      growth,
      growthPercentage,
      previousViews,
      reliability
    };
  });

  return trends
    .filter(article => article.growth && article.growth > 0)
    .sort((a, b) => {
      if (a.reliability !== b.reliability) {
        return a.reliability === 'high' ? -1 : 1;
      }
      return (b.growth || 0) - (a.growth || 0);
    });
}

/**
 * Filtre des articles liés à la Suisse (version améliorée)
 */
async function filterSwissArticlesV2(articles: Article[], language: Language): Promise<Article[]> {
  const swissTerms = {
    locations: [
      'zurich', 'zürich', 'genève', 'geneva', 'genf', 'basel', 'bâle', 'bern', 'berne',
      'lausanne', 'winterthur', 'winterthour', 'lucerne', 'luzern', 'lugano', 'sankt gallen',
      'saint-gall', 'biel', 'bienne', 'thun', 'thoune', 'köniz', 'fribourg', 'freiburg',
      'schaffhausen', 'schaffhouse', 'chur', 'coire', 'sion', 'sitten', 'bellinzona'
    ],
    general: [
      'suisse', 'schweiz', 'switzerland', 'svizzera', 'swiss', 'schweizerische',
      'fédéral', 'federal', 'confederation', 'confédération', 'eidgenössische',
      'national', 'bundesrat', 'conseil fédéral'
    ]
  };

  const allTerms = [...new Set([...swissTerms.locations, ...swissTerms.general])];

  const keywordFilteredArticles = articles.filter(article => {
    const decodedTitle = decodeURIComponent(article.article.toLowerCase()).replace(/_/g, ' ');
    return allTerms.some(term => decodedTitle.includes(term.toLowerCase()));
  });

  if (keywordFilteredArticles.length >= 10) {
    return keywordFilteredArticles;
  }

  try {
    const remainingArticles = articles.filter(article =>
      !keywordFilteredArticles.some(filtered => filtered.article === article.article)
    );

    const batchSize = 50;
    let allCategoryFiltered: Article[] = [...keywordFilteredArticles];

    for (let i = 0; i < remainingArticles.length; i += batchSize) {
      const batch = remainingArticles.slice(i, i + batchSize);
      const enriched = await enrichArticlesWithMetadata(batch, language);

      const swissCategoryKeywords = ['suisse', 'schweiz', 'switzerland', 'svizzera'];

      const categoryFiltered = enriched.filter(article => {
        if (!article.metadata?.categories) return false;
        return article.metadata.categories.some(category =>
          swissCategoryKeywords.some(keyword =>
            category.toLowerCase().includes(keyword)
          )
        );
      });

      allCategoryFiltered = [...allCategoryFiltered, ...categoryFiltered];
      if (allCategoryFiltered.length >= 50) break;
    }

    return allCategoryFiltered;
  } catch (error) {
    console.error('Error during category filtering:', error);
    return keywordFilteredArticles;
  }
}

/**
 * Enrichit les articles avec des métadonnées de l'API MediaWiki
 */
async function enrichArticlesWithMetadata(articles: Article[], language: Language): Promise<Article[]> {
  if (articles.length === 0) return [];

  try {
    const batchSize = 25;
    const enrichedArticles: Article[] = [];

    for (let i = 0; i < articles.length; i += batchSize) {
      const batch = articles.slice(i, i + batchSize);
      const titles = batch.map(article =>
        decodeURIComponent(article.article).replace(/_/g, ' ')
      );

      const metadata = await getArticleMetadata(titles, language);

      const enriched = batch.map(article => {
        const title = decodeURIComponent(article.article).replace(/_/g, ' ');
        const articleMetadata = metadata[title];

        if (articleMetadata) {
          return {
            ...article,
            metadata: {
              description: articleMetadata.description || '',
              thumbnail: articleMetadata.thumbnail || '',
              categories: articleMetadata.categories || [],
              extract: articleMetadata.extract || ''
            }
          };
        }

        return article;
      });

      enrichedArticles.push(...enriched);
    }

    return enrichedArticles;
  } catch (error) {
    console.error('Error enriching articles with metadata:', error);
    return articles;
  }
}

/**
 * Récupère les métadonnées des articles via l'API MediaWiki
 */
async function getArticleMetadata(titles: string[], language: Language): Promise<Record<string, { description: string; thumbnail: string; categories: string[]; extract: string }>> {
  if (titles.length === 0) return {};

  const titlesParam = titles.map(t => encodeURIComponent(t)).join('|');
  const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|extracts|categories&exintro=1&explaintext=1&pithumbsize=100&pilimit=${titles.length}&cllimit=10&titles=${titlesParam}&formatversion=2&origin=*`;

  try {
    const data = await fetchFromAPI<MediaWikiResponse>(url);
    const pages = data.query.pages;

    const metadata: Record<string, { description: string; thumbnail: string; categories: string[]; extract: string }> = {};
    pages.forEach(page => {
      metadata[page.title] = {
        description: page.extract?.substring(0, 150) || '',
        thumbnail: page.thumbnail?.source || '',
        categories: page.categories?.map(cat => cat.title) || [],
        extract: page.extract || ''
      };
    });

    return metadata;
  } catch (error) {
    console.error('Error fetching article metadata:', error);
    return {};
  }
}

/**
 * Récupère l'historique des vues quotidiennes pour un article
 */
export async function fetchArticleViewHistory(article: string, language: Language, days: number = 30): Promise<{ date: string; views: number }[]> {
  const today = new Date();
  const startDate = new Date();
  startDate.setDate(today.getDate() - days);

  const startFormatted = format(startDate, 'yyyyMMdd');
  const endFormatted = format(today, 'yyyyMMdd');

  const encodedArticle = encodeURIComponent(article);
  const url = `${API_BASE}/per-article/${language}.wikipedia/all-access/all-agents/${encodedArticle}/daily/${startFormatted}/${endFormatted}`;

  const data = await fetchFromAPI<{ items?: { timestamp: string; views: number }[] }>(url);

  if (!data.items || data.items.length === 0) {
    return [];
  }

  return data.items.map(item => ({
    date: `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`,
    views: item.views
  }));
}
