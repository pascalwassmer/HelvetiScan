import { Article, Language, Period, ApiResponse, MediaWikiResponse } from './types';
import { format, subDays } from 'date-fns';

const API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews";
const USER_AGENT = "HelvetiScan/1.0 (educational project; contact@example.com)";

// Implémentation d'un cache simple en mémoire
const cache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes en millisecondes

/**
 * Récupère les données depuis l'API avec cache et retry
 */
async function fetchFromAPI(url: string): Promise<any> {
  const cacheKey = url;
  const now = Date.now();
  
  // Vérifier le cache
  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    console.log(`[Cache hit] ${url}`);
    return cache[cacheKey].data;
  }
  
  // Logique de retry avec backoff exponentiel
  let retries = 3;
  let delay = 1000;
  let lastError;
  
  while (retries > 0) {
    try {
      console.log(`[API Request] ${url}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT
        }
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText} (${response.status})`);
      }
      
      const data = await response.json();
      
      // Mettre en cache les résultats
      cache[cacheKey] = { data, timestamp: now };
      
      return data;
    } catch (error) {
      console.error(`Attempt failed for ${url}:`, error);
      lastError = error;
      retries--;
      
      if (retries > 0) {
        // Attendre avec un délai exponentiel avant de réessayer
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Backoff exponentiel
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

  const unwantedPages = [
    'Wikipédia:Accueil_principal', 'Wikipedia:Main_Page',
    'Wikipedia:Hauptseite', 'Wikipedia:Portada',
    'Cookie_(informatique)', 'HTTP_cookie', 'Cookie',
    'Recherche', 'Search', 'Suche', 'Búsqueda'
  ];

  return articles.filter(article => {
    const decodedTitle = decodeURIComponent(article.article);
    return !unwantedPrefixes.some(prefix => decodedTitle.startsWith(prefix)) &&
           !unwantedPages.some(page => decodedTitle === page);
  });
}

/**
 * Récupère les articles les plus consultés
 */
export async function fetchTopArticles(language: Language, period: Period, swissOnly: boolean): Promise<Article[]> {
  try {
    const date = new Date();
    const formattedDate = format(subDays(date, 1), 'yyyyMMdd');
    const project = `${language}.wikipedia`;
    
    const url = `${API_BASE}/top/${project}/all-access/${formattedDate.slice(0, 4)}/${formattedDate.slice(4, 6)}/${formattedDate.slice(6, 8)}`;
    
    const data = await fetchFromAPI(url) as ApiResponse;
    let articles = data.items[0].articles;
    
    // Filtrer d'abord les pages non désirées
    articles = filterUnwantedPages(articles);

    if (swissOnly) {
      // Méthode améliorée pour le filtrage suisse
      articles = await filterSwissArticlesV2(articles, language);
    }
    
    // Récupérer les métadonnées pour enrichir les articles
    if (articles.length > 0) {
      const enrichedArticles = await enrichArticlesWithMetadata(articles, language);
      return enrichedArticles.slice(0, 50);
    }
    
    // Limiter à 50 articles après le filtrage
    return articles.slice(0, 50);
  } catch (error) {
    console.error('Error fetching top articles:', error);
    return [];
  }
}

/**
 * Récupère les articles en progression
 */
export async function fetchTrendingArticles(language: Language, period: Period, swissOnly: boolean): Promise<Article[]> {
  try {
    // Pour les articles en tendance, on récupère plus d'articles initialement
    const currentData = await fetchTopArticles(language, period, false);
    const previousData = await fetchPreviousPeriodData(language, period);

    let trendingArticles = calculateTrendsImproved(currentData, previousData);
    
    if (swissOnly) {
      trendingArticles = await filterSwissArticlesV2(trendingArticles, language);
    }

    return trendingArticles.slice(0, 50);
  } catch (error) {
    console.error('Error fetching trending articles:', error);
    return [];
  }
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

  try {
    const data = await fetchFromAPI(url) as ApiResponse;
    let articles = data.items[0].articles;
    articles = filterUnwantedPages(articles);
    return articles;
  } catch (error) {
    console.error('Error fetching previous period data:', error);
    return [];
  }
}

/**
 * Calcul amélioré des tendances avec fiabilité
 */
function calculateTrendsImproved(currentArticles: Article[], previousArticles: Article[]): Article[] {
  const trends = currentArticles.map(current => {
    const previous = previousArticles.find(p => p.article === current.article);
    const previousViews = previous?.views || 0;
    
    // Éviter division par zéro et articles avec trop peu de vues
    if (previousViews < 100) {
      return {
        ...current,
        growth: 0,
        growthPercentage: 0,
        previousViews,
        reliability: 'low'
      };
    }
    
    const growth = current.views - previousViews;
    const growthPercentage = (growth / previousViews) * 100;
    
    // Calculer un score de fiabilité basé sur le nombre de vues
    let reliability = 'medium';
    if (current.views > 10000 && previousViews > 1000) {
      reliability = 'high';
    }
    
    return {
      ...current,
      growth,
      growthPercentage,
      previousViews,
      reliability
    };
  });

  // Trier d'abord par fiabilité, puis par croissance
  return trends
    .filter(article => article.growth && article.growth > 0)
    .sort((a, b) => {
      // Donner priorité aux articles à haute fiabilité
      if (a.reliability !== b.reliability) {
        return a.reliability === 'high' ? -1 : 1;
      }
      // Ensuite trier par croissance
      return (b.growth || 0) - (a.growth || 0);
    });
}

/**
 * Filtre des articles liés à la Suisse (version améliorée)
 */
async function filterSwissArticlesV2(articles: Article[], language: Language): Promise<Article[]> {
  // Combiner les deux approches: mots-clés et catégories Wikipedia
  
  // 1. Approche par mots-clés (rapide)
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

  // Créer une liste unique de tous les termes
  const allTerms = [...new Set([
    ...swissTerms.locations,
    ...swissTerms.general
  ])];

  // Premier filtre rapide avec les mots-clés
  const keywordFilteredArticles = articles.filter(article => {
    const decodedTitle = decodeURIComponent(article.article.toLowerCase())
      .replace(/_/g, ' ');
    return allTerms.some(term => decodedTitle.includes(term.toLowerCase()));
  });

  // Si nous avons assez d'articles avec le filtre par mots-clés, on s'arrête là
  if (keywordFilteredArticles.length >= 10) {
    return keywordFilteredArticles;
  }
  
  // 2. Approche par catégories Wikipedia (plus précise mais plus lente)
  try {
    // Récupérer les métadonnées pour les articles restants
    const remainingArticles = articles.filter(article => 
      !keywordFilteredArticles.some(filtered => filtered.article === article.article)
    );
    
    // Limiter la taille des lots pour éviter de surcharger l'API
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
      
      // Si nous avons assez d'articles, on s'arrête
      if (allCategoryFiltered.length >= 50) break;
    }
    
    return allCategoryFiltered;
  } catch (error) {
    console.error('Error during category filtering:', error);
    // En cas d'erreur, on retourne les résultats du filtre par mots-clés
    return keywordFilteredArticles;
  }
}

/**
 * Enrichit les articles avec des métadonnées de l'API MediaWiki
 */
async function enrichArticlesWithMetadata(articles: Article[], language: Language): Promise<Article[]> {
  if (articles.length === 0) return [];
  
  try {
    // Diviser les articles en lots de 25 (limite de l'API MediaWiki)
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
async function getArticleMetadata(titles: string[], language: Language): Promise<Record<string, any>> {
  if (titles.length === 0) return {};
  
  const titlesParam = titles.map(t => encodeURIComponent(t)).join('|');
  const url = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages|extracts|categories&exintro=1&explaintext=1&pithumbsize=100&pilimit=${titles.length}&cllimit=10&titles=${titlesParam}&formatversion=2&origin=*`;
  
  try {
    const data = await fetchFromAPI(url) as MediaWikiResponse;
    const pages = data.query.pages;
    
    // Transformer la réponse en map titre => métadonnées
    const metadata: Record<string, any> = {};
    pages.forEach((page: any) => {
      metadata[page.title] = {
        description: page.extract?.substring(0, 150) || '',
        thumbnail: page.thumbnail?.source || '',
        categories: page.categories?.map((cat: any) => cat.title) || [],
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
export async function fetchArticleViewHistory(article: string, language: Language, days: number = 30): Promise<any[]> {
  try {
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - days);
    
    const startFormatted = format(startDate, 'yyyyMMdd');
    const endFormatted = format(today, 'yyyyMMdd');
    
    const encodedArticle = encodeURIComponent(article);
    const url = `${API_BASE}/per-article/${language}.wikipedia/all-access/all-agents/${encodedArticle}/daily/${startFormatted}/${endFormatted}`;
    
    const data = await fetchFromAPI(url);
    
    if (!data.items || data.items.length === 0) {
      return [];
    }
    
    return data.items.map((item: any) => ({
      date: `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}-${item.timestamp.slice(6, 8)}`,
      views: item.views
    }));
  } catch (error) {
    console.error('Error fetching article view history:', error);
    return [];
  }
}
