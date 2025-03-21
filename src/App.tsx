import React, { useState, useEffect, useCallback } from 'react';
import { Globe2, TrendingUp, BarChart } from 'lucide-react';
import { fetchTopArticles, fetchTrendingArticles } from './api';
import { Article, Language, Period, Tab } from './types';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('mostViewed');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('fr');
  const [activePeriod, setActivePeriod] = useState<Period>('daily');
  const [swissOnly, setSwissOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Article[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const articles = activeTab === 'mostViewed'
        ? await fetchTopArticles(selectedLanguage, activePeriod, swissOnly)
        : await fetchTrendingArticles(selectedLanguage, activePeriod, swissOnly);
      setData(articles);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Une erreur est survenue lors du chargement des données. Veuillez réessayer plus tard.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedLanguage, activePeriod, swissOnly]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const languages: { code: Language; name: string }[] = [
    { code: 'fr', name: 'Français' },
    { code: 'en', name: 'English' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
  ];

  const periods: { value: Period; label: string }[] = [
    { value: 'daily', label: 'Temps réel' },
    { value: '48h', label: '48 heures' },
    { value: 'weekly', label: 'Semaine' },
    { value: 'monthly', label: 'Mois' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Globe2 className="h-8 w-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">WikiTrends</h1>
            </div>
            <div className="flex space-x-4">
              {languages.map(({ code, name }) => (
                <button
                  key={code}
                  onClick={() => setSelectedLanguage(code)}
                  className={`px-3 py-2 rounded-md text-sm font-medium ${
                    selectedLanguage === code
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <div className="flex">
              <button
                onClick={() => setActiveTab('mostViewed')}
                className={`flex items-center px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'mostViewed'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <BarChart className="h-5 w-5 mr-2" />
                Articles les plus consultés
              </button>
              <button
                onClick={() => setActiveTab('trending')}
                className={`flex items-center px-6 py-4 text-sm font-medium border-b-2 ${
                  activeTab === 'trending'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <TrendingUp className="h-5 w-5 mr-2" />
                Articles en progression
              </button>
            </div>
          </div>

          <div className="p-4">
            <div className="flex flex-wrap gap-4 mb-6">
              {periods.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setActivePeriod(value)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    activePeriod === value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              <label className="flex items-center space-x-2 ml-auto">
                <input
                  type="checkbox"
                  checked={swissOnly}
                  onChange={(e) => setSwissOnly(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Internautes suisses uniquement</span>
              </label>
            </div>

            {error ? (
              <div className="text-red-600 p-4 text-center">{error}</div>
            ) : loading ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Rang
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Article
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Vues
                      </th>
                      {activeTab === 'trending' && (
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Progression
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {data.map((item, index) => (
                      <tr key={item.article} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <a
                            href={`https://${selectedLanguage}.wikipedia.org/wiki/${item.article}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800"
                          >
                            {decodeURIComponent(item.article.replace(/_/g, ' '))}
                          </a>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {item.views.toLocaleString()}
                        </td>
                        {activeTab === 'trending' && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={item.growth && item.growth > 0 ? 'text-green-600' : 'text-red-600'}>
                              {item.growth && item.growth > 0 ? '+' : ''}
                              {item.growth?.toLocaleString()} ({item.growthPercentage?.toFixed(1)}%)
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-center text-sm text-gray-500">
          Données fournies par l'API Wikimedia Pageviews. 
          Dernière mise à jour: {lastUpdated.toLocaleString()}
        </p>
      </footer>
    </div>
  );
}

export default App;