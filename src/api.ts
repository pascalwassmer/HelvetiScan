import { Article, Language, Period, ApiResponse } from './types';
import { format, subDays } from 'date-fns';

const API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews";

async function fetchFromAPI(url: string): Promise<ApiResponse> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }
  return response.json();
}

function filterUnwantedPages(articles: Article[]): Article[] {
  const unwantedPrefixes = [
    'Wikipédia:',
    'Wikipedia:',
    'Special:',
    'Spécial:',
    'Speciale:',
    'Spezial:',
    'MediaWiki:',
    'Help:',
    'Aide:',
    'Hilfe:',
    'Ayuda:',
    'Template:',
    'Modèle:',
    'Vorlage:',
    'Plantilla:',
    'User:',
    'Utilisateur:',
    'Benutzer:',
    'Usuario:',
    'Talk:',
    'Discussion:',
    'Diskussion:',
    'Discusión:'
  ];

  const unwantedPages = [
    'Wikipédia:Accueil_principal',
    'Wikipedia:Main_Page',
    'Wikipedia:Hauptseite',
    'Wikipedia:Portada',
    'Cookie_(informatique)',
    'HTTP_cookie',
    'Cookie',
    'Recherche',
    'Search',
    'Suche',
    'Búsqueda'
  ];

  return articles.filter(article => {
    const decodedTitle = decodeURIComponent(article.article);
    return !unwantedPrefixes.some(prefix => decodedTitle.startsWith(prefix)) &&
           !unwantedPages.some(page => decodedTitle === page);
  });
}

export async function fetchTopArticles(language: Language, period: Period, swissOnly: boolean): Promise<Article[]> {
  try {
    const date = new Date();
    const formattedDate = format(subDays(date, 1), 'yyyyMMdd');
    const project = `${language}.wikipedia`;
    
    const url = `${API_BASE}/top/${project}/all-access/${formattedDate.slice(0, 4)}/${formattedDate.slice(4, 6)}/${formattedDate.slice(6, 8)}`;
    
    const data = await fetchFromAPI(url);
    let articles = data.items[0].articles;
    
    // Filtrer d'abord les pages non désirées
    articles = filterUnwantedPages(articles);

    if (swissOnly) {
      // Appliquer le filtre suisse avant de limiter à 50 articles
      articles = await filterSwissArticles(articles, language);
    }
    
    // Limiter à 50 articles après le filtrage
    return articles.slice(0, 50);
  } catch (error) {
    console.error('Error fetching top articles:', error);
    return [];
  }
}

export async function fetchTrendingArticles(language: Language, period: Period, swissOnly: boolean): Promise<Article[]> {
  try {
    // Pour les articles en tendance, on récupère plus d'articles initialement
    const currentData = await fetchTopArticles(language, period, false);
    const previousData = await fetchPreviousPeriodData(language, period);

    let trendingArticles = calculateTrends(currentData, previousData);
    
    if (swissOnly) {
      trendingArticles = await filterSwissArticles(trendingArticles, language);
    }

    return trendingArticles.slice(0, 50);
  } catch (error) {
    console.error('Error fetching trending articles:', error);
    return [];
  }
}

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
    const data = await fetchFromAPI(url);
    let articles = data.items[0].articles;
    articles = filterUnwantedPages(articles);
    return articles;
  } catch (error) {
    console.error('Error fetching previous period data:', error);
    return [];
  }
}

function calculateTrends(currentArticles: Article[], previousArticles: Article[]): Article[] {
  const trends = currentArticles.map(current => {
    const previous = previousArticles.find(p => p.article === current.article);
    const previousViews = previous?.views || 0;
    const growth = current.views - previousViews;
    const growthPercentage = previousViews > 0 ? (growth / previousViews) * 100 : 0;

    return {
      ...current,
      growth,
      growthPercentage
    };
  });

  return trends.sort((a, b) => (b.growth || 0) - (a.growth || 0));
}

async function filterSwissArticles(articles: Article[], language: Language): Promise<Article[]> {
  const swissTerms = {
    locations: [
      // Grandes villes
      'zurich', 'zürich', 'genève', 'geneva', 'genf', 'basel', 'bâle', 'bern', 'berne',
      'lausanne', 'winterthur', 'winterthour', 'lucerne', 'luzern', 'lugano', 'sankt gallen',
      'saint-gall', 'biel', 'bienne', 'thun', 'thoune', 'köniz', 'fribourg', 'freiburg',
      'schaffhausen', 'schaffhouse', 'chur', 'coire', 'sion', 'sitten', 'bellinzona',
      
      // Cantons
      'vaud', 'waadt', 'valais', 'wallis', 'neuchâtel', 'neuenburg', 'jura',
      'aargau', 'argovie', 'thurgau', 'thurgovie', 'graubünden', 'grisons',
      'ticino', 'tessin', 'schwyz', 'solothurn', 'soleure', 'zug', 'zoug',
      
      // Régions
      'romandie', 'suisse romande', 'westschweiz', 'deutschschweiz', 'svizzera italiana',
      'gruyère', 'lavaux', 'emmental', 'engadin', 'engadine'
    ],
    organizations: [
      'swisscom', 'migros', 'coop', 'ubs', 'credit suisse', 'nestlé', 'novartis', 'roche',
      'sbb', 'cff', 'ffs', 'swiss', 'swissair', 'raiffeisen', 'post', 'poste', 'ptt',
      'eth', 'epfl', 'epfz', 'unige', 'unil', 'unifr', 'unine', 'usi', 'hslu'
    ],
    sports: [
      'fc basel', 'fc bâle', 'fc zürich', 'bsc young boys', 'servette', 'fc sion',
      'fc lugano', 'fc st. gallen', 'grasshopper', 'lausanne-sport',
      'swiss football', 'football suisse', 'schweizer fussball',
      'swiss ice hockey', 'hockey sur glace suisse'
    ],
    general: [
      'suisse', 'schweiz', 'switzerland', 'svizzera', 'swiss', 'schweizerische',
      'fédéral', 'federal', 'confederation', 'confédération', 'eidgenössische',
      'nationale', 'national', 'bundesrat', 'conseil fédéral'
    ]
  };

  // Créer une liste unique de tous les termes
  const allTerms = [...new Set([
    ...swissTerms.locations,
    ...swissTerms.organizations,
    ...swissTerms.sports,
    ...swissTerms.general
  ])];

  // Fonction pour vérifier si un article contient des termes suisses
  const isSwissArticle = (article: Article): boolean => {
    const decodedTitle = decodeURIComponent(article.article.toLowerCase())
      .replace(/_/g, ' ');

    // Vérifier si le titre contient au moins un terme suisse
    return allTerms.some(term => decodedTitle.includes(term.toLowerCase()));
  };

  // Filtrer les articles
  const swissArticles = articles.filter(isSwissArticle);

  // Si nous n'avons pas assez d'articles, essayer d'ajouter des articles des autres langues
  if (swissArticles.length < 10 && language !== 'fr') {
    try {
      const frenchArticles = await fetchTopArticles('fr', 'daily', true);
      swissArticles.push(...frenchArticles.filter(art => 
        !swissArticles.some(existing => existing.article === art.article)
      ));
    } catch (error) {
      console.error('Error fetching French articles:', error);
    }
  }

  if (swissArticles.length < 10 && language !== 'de') {
    try {
      const germanArticles = await fetchTopArticles('de', 'daily', true);
      swissArticles.push(...germanArticles.filter(art => 
        !swissArticles.some(existing => existing.article === art.article)
      ));
    } catch (error) {
      console.error('Error fetching German articles:', error);
    }
  }

  return swissArticles;
}